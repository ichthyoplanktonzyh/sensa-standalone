/** Read-only logical edge projection for assertions across the compact FK
 * representation. Tests still count actual pins and inspect physical indexes. */
export const libraryCloudMembershipRows=`(SELECT m.account_id,o.owner_kind,o.owner AS owner_id,b.hash
 FROM sensa_consumer.library_cloud_membership m
 JOIN sensa_consumer.library_cloud_owners o ON o.account_id=m.account_id AND o.id=m.owner_id
 JOIN sensa_consumer.library_cloud_blocks b ON b.account_id=m.account_id AND b.block_id=m.block_id)`;
