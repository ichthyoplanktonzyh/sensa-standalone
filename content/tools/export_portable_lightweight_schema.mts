import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";

import {z} from "zod";
import {sensaPortableLightweightPackageSchema} from "@sensa/contracts/sensa";

const output = resolve("content/schema/portable-lightweight-package-v1.schema.json");
const schema = z.toJSONSchema(sensaPortableLightweightPackageSchema, {
  target: "draft-2020-12",
  io: "input",
});
const document = {
  $id: "https://sensa.example/schema/portable-lightweight-package-v1.json",
  title: "Sensa Portable Lightweight Package v1",
  description: "Public package.json manifest for a .sensa archive. Raw media uses content-addressed archive entries; authoring workflow is out of scope.",
  ...schema,
};
await mkdir(dirname(output), {recursive: true});
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(output);
