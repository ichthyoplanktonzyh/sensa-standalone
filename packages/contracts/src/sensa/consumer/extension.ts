import {z} from 'zod';
import {sensaFormalPinnedLanguageContextSchema,sensaLanguageRouteCollectionSchema} from '../language.js';
import {sensaReadingGlossarySchema} from './reading.js';
import {sensaBrowserIntakeDeliverySchema,sensaBrowserIntakeReceiptSchema} from '../browserIntake.js';

/**
 * Everything the Web application and the browser extension say to each other.
 *
 * One feature, two wires: the handshake that ends with an extension credential,
 * and the page bridge the two use afterwards. Both used to be written down
 * separately at every end that touched them — the API's route schemas, the Web
 * application's own copies, the service worker's handlers, and the isolated-world
 * forwarder's list of fields to pass along — so a field added at two ends and
 * forgotten at the third was dropped in silence instead of refused. They are
 * declared once, here: the Web application reads them as types for what it
 * builds, the extension and the API as the values they accept.
 */

/**
 * A request to bind a new installation to a Web session.
 *
 * The challenge is the hash of a verifier only the extension holds, so the code
 * that comes back through the browser can be redeemed by that installation and
 * no other. The redirect is pinned to the identity URL shape Chrome gives an
 * extension, because a looser one would be a redirect a page could receive.
 */
export const sensaExtensionAuthorizationSchema=z.object({
  installationId:z.string().uuid(),
  state:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  redirectUri:z.string().url().refine(value=>/^https:\/\/[a-p]{32}\.chromiumapp\.org\/sensa$/u.test(value)),
}).strict();

/**
 * The extension's half of the handshake.
 *
 * `state` carries the same shape as the state that was authorized: it is compared
 * against the stored one, and a value the authorization could not have produced is
 * not a value worth comparing against it.
 */
export const sensaExtensionExchangeSchema=z.object({
  code:z.string().uuid(),
  installationId:z.string().uuid(),
  state:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  verifier:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
}).strict();

/** What the API answers the Web application with: the extension's own identity
 * URL carrying the one-time code, which the Web forwards without reading it. */
export const sensaExtensionAuthorizeResultSchema=z.object({
  redirectUri:z.string().url(),
}).strict();

/** What the installation receives for redeeming the code: one account's
 * credential, with the expiry the API chose. The token is the only secret here,
 * and it travels to the extension alone — never back through the page. */
export const sensaExtensionCredentialSchema=z.object({
  token:z.string().min(1),
  accountId:z.string().uuid(),
  expiresAt:z.string().datetime(),
}).strict();

/** A page announces itself with this channel, and the extension answers on the
 * other one. The names are the wire: an unrelated page's `postMessage` traffic
 * never parses as a request. */
export const sensaBridgeRequestChannel='sensa-web-intake-request';
export const sensaBridgeResponseChannel='sensa-web-intake-response';
/** The page's own request id, echoed back so several requests can be in flight
 * at once. Bounded because it is attacker-adjacent input: any page that loads
 * this bundle may post on this channel, and the extension must not be made to
 * hold an unbounded string. */
export const sensaBridgeMaxRequestIdLength=100;

const requestId=z.string().min(1).max(sensaBridgeMaxRequestIdLength);
const pageRequest={
  channel:z.literal(sensaBridgeRequestChannel),
  id:requestId,
  accountId:z.string().uuid(),
};
const libraryRequest={...pageRequest,libraryId:z.string().uuid()};

/**
 * Every request a Web page may make of the extension.
 *
 * The account and library are claims, not authority: the extension checks both
 * against the account it is actually connected to, because a page is a caller
 * and not a source of truth. Sign-out is the one request without a library —
 * it ends the connection instead of using one, and a page that is signing out
 * does not have to have a library open to do it.
 */
export const sensaBridgeRequestSchema=z.discriminatedUnion('kind',[
  /** Captures this library has not received yet, oldest first. */
  z.object({...libraryRequest,kind:z.literal('web-intake-pull')}).strict(),
  /** The page's record that it committed a capture. The extension keeps it as an
   * idempotency receipt and stops handing that request over. */
  z.object({...libraryRequest,kind:z.literal('web-intake-ack'),receipt:sensaBrowserIntakeReceiptSchema}).strict(),
  /** Starts a connection for the tab that asked, if it has none. */
  z.object({...libraryRequest,kind:z.literal('web-connect-prepare')}).strict(),
  /** Hands back the redirect the extension's own page came home with. */
  z.object({...libraryRequest,kind:z.literal('web-connect-complete'),receipt:z.object({redirectUri:z.string().url()}).strict()}).strict(),
  /** The learner's reconnect decision, including whether their unsent captures
   * are dropped. Required rather than defaulted: discarding a learner's captures
   * is a choice only the learner makes, so the request states it or is refused. */
  z.object({...libraryRequest,kind:z.literal('web-connect-reset'),receipt:z.object({discardPending:z.boolean()}).strict()}).strict(),
  /** The Web session ended, so the account's credentials and reading state go. */
  z.object({...pageRequest,kind:z.literal('web-session-ended')}).strict(),
  /** The learner-owned Routes. The extension keeps its own surface-scoped
   * Active Route Selection while Web remains the only Route editor. */
  z.object({...libraryRequest,kind:z.literal('web-language-routes'),routes:sensaLanguageRouteCollectionSchema}).strict(),
  /** The learner's own glossary, which every reading request carries. Published
   * the same way and for the same reason as the pair: the library owns it, and
   * this is the copy the reading surfaces will hand to the service. */
  z.object({...libraryRequest,kind:z.literal('web-reading-glossary'),glossary:sensaReadingGlossarySchema}).strict(),
]);

/**
 * The kinds as a plain list, read off the declaration above.
 *
 * The isolated-world forwarder is a page-scoped script: it runs on every load of
 * the Web application, so it carries no schema and no catalog. It still refuses a
 * kind the bridge does not have — a page must not be able to reach the extension's
 * other features through the bridge's channel — and this is where that list comes
 * from: the build injects it, so the forwarder holds no copy of it.
 */
export const sensaBridgeKinds=sensaBridgeRequestSchema.options.map(option=>option.shape.kind.value);

/** An answer, once the envelope says a handler produced one. */
export const sensaBridgeResponseSchemas={
  'web-intake-pull':z.array(sensaBrowserIntakeDeliverySchema).max(10),
  'web-intake-ack':z.object({acknowledged:z.literal(true)}).strict(),
  'web-connect-prepare':z.object({
    connected:z.literal(true).optional(),
    paused:z.literal(true).optional(),
    authorization:sensaExtensionAuthorizationSchema.optional(),
  }).strict(),
  'web-connect-complete':z.object({connected:z.literal(true)}).strict(),
  'web-connect-reset':z.object({reset:z.literal(true)}).strict(),
  'web-session-ended':z.object({disconnected:z.boolean()}).strict(),
  'web-language-routes':sensaFormalPinnedLanguageContextSchema,
  'web-reading-glossary':sensaReadingGlossarySchema,
} satisfies Record<SensaBridgeKind,z.ZodType>;

/** The two things a bridge turn can come back as. The error member carries the
 * handler's own code — `account_mismatch`, `library_mismatch`, `unsupported_message`
 * — because the Web application puts a different word and a different recovery in
 * front of the learner for each of them. */
export const sensaBridgeResponseSchema=z.union([
  z.object({channel:z.literal(sensaBridgeResponseChannel),id:requestId,value:z.unknown()}).strict(),
  z.object({channel:z.literal(sensaBridgeResponseChannel),id:requestId,error:z.string().min(1).max(64)}).strict(),
]);

export type SensaExtensionAuthorization=z.infer<typeof sensaExtensionAuthorizationSchema>;
export type SensaExtensionAuthorizeResult=z.infer<typeof sensaExtensionAuthorizeResultSchema>;
export type SensaExtensionExchange=z.infer<typeof sensaExtensionExchangeSchema>;
export type SensaExtensionCredential=z.infer<typeof sensaExtensionCredentialSchema>;
export type SensaBridgeRequest=z.infer<typeof sensaBridgeRequestSchema>;
export type SensaBridgeResponse=z.infer<typeof sensaBridgeResponseSchema>;
export type SensaBridgeKind=SensaBridgeRequest['kind'];
export type SensaBridgeRequestOf<K extends SensaBridgeKind>=Extract<SensaBridgeRequest,{kind:K}>;
/** What a caller supplies for one kind: the envelope fields belong to the bridge,
 * not to the call site. A misspelled payload field is then a type error rather
 * than a request the other end refuses at runtime. */
export type SensaBridgePayload<K extends SensaBridgeKind>=Omit<SensaBridgeRequestOf<K>,'channel'|'id'|'kind'|'accountId'|'libraryId'>;
export type SensaBridgeValue<K extends SensaBridgeKind>=z.infer<(typeof sensaBridgeResponseSchemas)[K]>;

/**
 * Reads one answer as the kind that asked for it.
 *
 * A refusal is thrown as an `Error` carrying the handler's code, which is how
 * every caller of this bridge already tells a mismatch from an outage; anything
 * that does not parse at all is a protocol disagreement and is thrown as one.
 */
export function sensaBridgeValue<K extends SensaBridgeKind>(kind:K,response:unknown):SensaBridgeValue<K>{
  const envelope=sensaBridgeResponseSchema.parse(response);
  if('error' in envelope)throw new Error(envelope.error);
  return sensaBridgeResponseSchemas[kind].parse(envelope.value) as SensaBridgeValue<K>;
}
