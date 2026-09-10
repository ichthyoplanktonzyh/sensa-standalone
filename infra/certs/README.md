# Supabase database trust root

`supabase-prod-ca-2021.crt` is the public Supabase Root 2021 CA, downloaded from
[Supabase's certificate distribution](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
The URL is published by Supabase Studio in
[`custom-content.json`](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).

SHA-256 fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
Expires April 26, 2031. This is a public certificate, not a private key.

The isolated trial CI workflow and documented local API command load it through
`NODE_EXTRA_CA_CERTS` before Node starts. Trial preparation selects `sslmode=verify-full`
to verify both the certificate chain and the database hostname. Do not work around
connection failures by disabling certificate verification.
