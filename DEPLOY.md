# Deploying to Cloud Run

CoachJan is one Cloud Run service (Express serving the built React app and the
API) backed by Cloud SQL for Postgres and a Cloud Storage bucket for uploaded
FIT files. This is written for a small closed group you create accounts for by
hand - there is no public signup.

Set these once and reuse them in every command below:

```shell
export PROJECT_ID=your-project-id
export REGION=europe-west1
export INSTANCE_NAME=coachjan-db
export DB_NAME=coachjan
export DB_USER=coachjan
export BUCKET_NAME=${PROJECT_ID}-coachjan-uploads
export SERVICE_NAME=coachjan

gcloud config set project "$PROJECT_ID"
```

## 1. Enable the APIs you need

```shell
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

## 2. Create the Cloud SQL Postgres instance, database and user

```shell
gcloud sql instances create "$INSTANCE_NAME" \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-size=10GB \
  --storage-auto-increase

gcloud sql databases create "$DB_NAME" --instance="$INSTANCE_NAME"

# Pick a real password and keep it - it goes straight into the DATABASE_URL secret below.
export DB_PASSWORD='change-me-to-something-long-and-random'
gcloud sql users create "$DB_USER" --instance="$INSTANCE_NAME" --password="$DB_PASSWORD"
```

Note the instance connection name, used below to build `DATABASE_URL` and to
pass `--add-cloudsql-instances`:

```shell
export CONNECTION_NAME=$(gcloud sql instances describe "$INSTANCE_NAME" --format='value(connectionName)')
echo "$CONNECTION_NAME"   # PROJECT_ID:REGION:INSTANCE_NAME
```

**Cloud SQL bills by the hour for as long as the instance exists, even if
nothing connects to it.** Cloud Run scales to zero between requests and costs
nothing while idle, but the database instance keeps billing regardless. Stop
it (`gcloud sql instances patch "$INSTANCE_NAME" --activation-policy=NEVER`)
or delete it if you want to stop paying for it between sessions.

## 3. Create the Cloud Storage bucket for FIT uploads

```shell
gcloud storage buckets create "gs://$BUCKET_NAME" \
  --location="$REGION" \
  --uniform-bucket-level-access
```

Cloud Run services run as a service account - by default the Compute Engine
default service account, unless you set one with `--service-account` on
`gcloud run deploy`. Grant that account write access to the bucket:

```shell
export RUN_SA=$(gcloud iam service-accounts list \
  --filter="displayName:'Compute Engine default service account'" \
  --format='value(email)')

gcloud storage buckets add-iam-policy-binding "gs://$BUCKET_NAME" \
  --member="serviceAccount:$RUN_SA" \
  --role="roles/storage.objectAdmin"
```

If you deploy with a dedicated service account instead, substitute its email
for `$RUN_SA` above and grant the same role to it, plus `roles/cloudsql.client`
(step 5 also needs that role for the Cloud SQL connection) and access to the
secrets in step 4.

## 4. Store secrets in Secret Manager

```shell
export JWT_SECRET=$(openssl rand -base64 48)
printf '%s' "$JWT_SECRET" | gcloud secrets create coachjan-jwt-secret --data-file=-

printf '%s' 'sk-ant-your-key' | gcloud secrets create coachjan-anthropic-key --data-file=-

# Unix-socket connection string for Cloud SQL from inside Cloud Run.
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"
printf '%s' "$DATABASE_URL" | gcloud secrets create coachjan-database-url --data-file=-
```

Grant the Cloud Run service account access to each secret:

```shell
for SECRET in coachjan-jwt-secret coachjan-anthropic-key coachjan-database-url; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:$RUN_SA" \
    --role="roles/secretmanager.secretAccessor"
done
```

To rotate a secret later (e.g. `JWT_SECRET`), add a new version rather than
recreating it - `gcloud secrets versions add coachjan-jwt-secret --data-file=-`
- then redeploy so the running revision picks it up.

## 5. Build and deploy

```shell
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

gcloud run deploy "$SERVICE_NAME" \
  --image="gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --region="$REGION" \
  --platform=managed \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --set-env-vars="PGSSL=false" \
  --set-secrets="JWT_SECRET=coachjan-jwt-secret:latest,ANTHROPIC_API_KEY=coachjan-anthropic-key:latest,DATABASE_URL=coachjan-database-url:latest" \
  --set-env-vars="GCS_BUCKET=${BUCKET_NAME}" \
  --allow-unauthenticated
```

`PGSSL=false` is correct for the Cloud SQL Unix socket connection used above
(`/cloudsql/...`), which doesn't negotiate TLS the way a TCP connection does.
Leave `PGSSL` unset or `false` for that socket path; only set it `true` if you
connect over TCP to a database that requires TLS.

`--allow-unauthenticated` makes the URL reachable without a Google login -
the app's own login screen is what gates access for your closed group. Drop
that flag and use `gcloud run services add-iam-policy-binding` instead if you
would rather gate it with Google identities too.

The app runs its own `migrate()` on startup, so the schema is created
automatically the first time the service starts against a fresh database.

## 6. Create user accounts

There is no signup page. Create each account by running the `create-user`
script as a one-off Cloud Run job against the deployed database, using the
same image you just deployed:

```shell
gcloud run jobs create coachjan-create-user \
  --image="gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --region="$REGION" \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --set-secrets="JWT_SECRET=coachjan-jwt-secret:latest,DATABASE_URL=coachjan-database-url:latest" \
  --command="npm" \
  --args="run,create-user,--" \
  --max-retries=0
```

Run it once per account, overriding the args with the email, password and
name for that person:

```shell
gcloud run jobs execute coachjan-create-user \
  --region="$REGION" \
  --args="run,create-user,--,friend@example.com,a-strong-password,Friend Name" \
  --wait
```

Re-running it for the same email updates that user's password instead of
creating a duplicate account, so it also doubles as a "reset this person's
password" command.

## Updating the deployment

Push a new build and redeploy the same way:

```shell
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
gcloud run deploy "$SERVICE_NAME" --image="gcr.io/${PROJECT_ID}/${SERVICE_NAME}" --region="$REGION"
```

Cloud Run keeps the previously configured secrets, Cloud SQL connection and
env vars on a redeploy that doesn't touch those flags.
