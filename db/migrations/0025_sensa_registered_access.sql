-- The API may create access for a verified login only under registered policy.
-- It cannot update/re-enable revoked invitations through this grant.
GRANT INSERT ON sensa_consumer.invitations TO backend_app;
