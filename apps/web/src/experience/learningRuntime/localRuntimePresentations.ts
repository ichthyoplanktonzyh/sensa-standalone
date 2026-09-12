import type {ReactNode} from 'react';
import {z} from 'zod';
import type {LocalLearningRun} from './localProtocol';

export const localRuntimePresentationContractVersion='sensa-local-runtime-presentation-v1' as const;

export const localRuntimePresentationCapabilitySchema=z.enum([
  'toast',
  'dictionary',
  'notes',
  'personal_scenes',
  'personal_content_menu',
  'declared_mastery',
]);

export const localRuntimePresentationBindingSchema=z.object({
  surface:z.string().trim().min(1),
  runtimeAdapterId:z.string().trim().min(1),
  purpose:z.enum(['initial_learning','retention_review','relearning']),
  protocolId:z.string().trim().min(1),
  protocolVersion:z.string().trim().min(1),
  localProtocolVersion:z.string().trim().min(1),
}).strict();

export type LocalRuntimePresentationBinding=z.infer<typeof localRuntimePresentationBindingSchema>;

const presentationBindingKey=(binding:LocalRuntimePresentationBinding):string=>JSON.stringify([
  binding.surface,
  binding.runtimeAdapterId,
  binding.purpose,
  binding.protocolId,
  binding.protocolVersion,
  binding.localProtocolVersion,
]);

export const localRuntimePresentationManifestSchema=z.object({
  contractVersion:z.literal(localRuntimePresentationContractVersion),
  pluginId:z.string().trim().min(1),
  pluginVersion:z.string().trim().min(1),
  displayName:z.string().trim().min(1),
  capabilities:z.array(localRuntimePresentationCapabilitySchema),
  bindings:z.array(localRuntimePresentationBindingSchema).min(1),
}).strict().superRefine((manifest,context)=>{
  if(new Set(manifest.capabilities).size!==manifest.capabilities.length){
    context.addIssue({code:'custom',path:['capabilities'],message:'Presentation capabilities must be unique.'});
  }
  const bindings=new Set<string>();
  manifest.bindings.forEach((binding,index)=>{
    const key=presentationBindingKey(binding);
    if(bindings.has(key))context.addIssue({code:'custom',path:['bindings',index],message:'Presentation bindings must be unique.'});
    bindings.add(key);
  });
});

export type LocalRuntimePresentationCapability=z.infer<typeof localRuntimePresentationCapabilitySchema>;
export type LocalRuntimePresentationManifest=z.infer<typeof localRuntimePresentationManifestSchema>;
export type LocalRuntimePresentationRequest=LocalRuntimePresentationBinding;

export interface LocalRuntimePresentationPlugin<Props>{
  readonly manifest:LocalRuntimePresentationManifest;
  readonly render:(props:Props)=>ReactNode;
}

const freezePresentationValue=<T,>(value:T):T=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.freeze(value);
    for(const child of Object.values(value as Record<string,unknown>))freezePresentationValue(child);
  }
  return value;
};

/** Render plugins receive a detached snapshot, never the store's live objects. */
export const immutablePresentationSnapshot=<T,>(value:T):T=>
  freezePresentationValue(structuredClone(value));

/** Resolve the exact presentation contract pinned by a Run. */
export function localRuntimePresentationRequest(
  run:LocalLearningRun,
  surface:string,
):LocalRuntimePresentationRequest{
  const binding=run.protocolBinding;
  if(run.protocolVersion!==binding.localProtocolVersion||!binding.localProtocolVersion){
    throw new Error('localFlow.resourceInvalid');
  }
  return localRuntimePresentationBindingSchema.parse({
    surface,
    runtimeAdapterId:binding.runtimeAdapterId,
    purpose:run.purpose,
    protocolId:binding.protocolId,
    protocolVersion:binding.protocolVersion,
    localProtocolVersion:binding.localProtocolVersion,
  });
}

/**
 * Version-exact Web presentation plugin seam.
 *
 * A plugin declares every Protocol binding it knows how to render and the
 * host capabilities it may receive. Resolution never falls back by surface or
 * adapter: a new Protocol version must be admitted explicitly.
 */
export class LocalRuntimePresentationRegistry<Props>{
  readonly #plugins=new Map<string,LocalRuntimePresentationPlugin<Props>>();
  readonly #bindings=new Map<string,LocalRuntimePresentationPlugin<Props>>();

  public constructor(plugins:readonly LocalRuntimePresentationPlugin<Props>[]=[]){
    for(const plugin of plugins)this.register(plugin);
  }

  public register(plugin:LocalRuntimePresentationPlugin<Props>):void{
    const manifest=freezePresentationValue(localRuntimePresentationManifestSchema.parse(plugin.manifest));
    const pluginKey=JSON.stringify([manifest.pluginId,manifest.pluginVersion]);
    if(this.#plugins.has(pluginKey))throw new Error(`Duplicate local Runtime presentation plugin: ${pluginKey}`);
    for(const binding of manifest.bindings){
      const bindingKey=presentationBindingKey(binding);
      if(this.#bindings.has(bindingKey))throw new Error(`Duplicate local Runtime presentation binding: ${bindingKey}`);
    }
    const admitted={manifest,render:plugin.render} satisfies LocalRuntimePresentationPlugin<Props>;
    this.#plugins.set(pluginKey,admitted);
    for(const binding of manifest.bindings)this.#bindings.set(presentationBindingKey(binding),admitted);
  }

  public resolve(request:LocalRuntimePresentationRequest):LocalRuntimePresentationPlugin<Props>{
    const parsed=localRuntimePresentationBindingSchema.parse(request);
    const plugin=this.#bindings.get(presentationBindingKey(parsed));
    if(!plugin)throw new Error(`No exact local Runtime presentation binding: ${presentationBindingKey(parsed)}`);
    return plugin;
  }

  public list():readonly LocalRuntimePresentationManifest[]{
    return [...this.#plugins.values()].map(plugin=>plugin.manifest);
  }
}
