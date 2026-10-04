/** SQL-only definitions shared with the lightweight Worker protocol. Keep
 * source decoding and domain validation in the database implementation. */
export const sqliteRegistrySelectionSchema=`
CREATE INDEX IF NOT EXISTS sensa_registry_binding_expression ON sensa_records(sensa_registry_field(value_json,'expressionId'),sensa_registry_field(value_json,'relation')) WHERE table_name='semanticRegistry' AND sensa_registry_field(value_json,'kind')='bindings';
CREATE UNIQUE INDEX IF NOT EXISTS sensa_registry_sense_key ON sensa_records(sensa_registry_field(value_json,'senseKey')) WHERE table_name='semanticRegistry' AND sensa_registry_field(value_json,'kind')='senses';
CREATE INDEX IF NOT EXISTS sensa_registry_kind_ordinal ON sensa_records(sensa_registry_field(value_json,'kind'),sensa_registry_field(value_json,'ordinal')) WHERE table_name='semanticRegistry';
CREATE INDEX IF NOT EXISTS sensa_registry_expression_form ON sensa_records(sensa_registry_field(value_json,'normalizedForm'),sensa_registry_field(value_json,'expressionId')) WHERE table_name='semanticRegistry' AND sensa_registry_field(value_json,'kind')='expressionVersions';
CREATE INDEX IF NOT EXISTS sensa_registry_binding_pair ON sensa_records(sensa_registry_field(value_json,'senseId'),sensa_registry_field(value_json,'expressionId'),sensa_registry_field(value_json,'relation')) WHERE table_name='semanticRegistry' AND sensa_registry_field(value_json,'kind')='bindings';
CREATE INDEX IF NOT EXISTS sensa_registry_binding_versions ON sensa_records(sensa_registry_field(value_json,'senseExpressionBindingId'),sensa_registry_field(value_json,'senseVersionId'),sensa_registry_field(value_json,'expressionVersionId'),sensa_registry_field(value_json,'semanticCoverage')) WHERE table_name='semanticRegistry' AND sensa_registry_field(value_json,'kind')='bindingVersions';
`;
