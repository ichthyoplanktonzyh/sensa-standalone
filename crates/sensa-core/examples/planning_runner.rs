//! No-cost source differential adapter; not part of the native bridge.
use sensa_core::planning::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{self, Read},
};
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Case {
    Conjoin {
        requirements: Vec<String>,
        provider: BTreeMap<String, Capability>,
    },
    Plan {
        profile: Box<Profile>,
        provider: BTreeMap<String, Capability>,
    },
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&input).unwrap();
    let out:Vec<Value>=cases.into_iter().map(|c|{
 let result=match c{
 Case::Conjoin{requirements,provider}=>conjoin_content(&requirements,&provider).map(|v|json!(v)),
 Case::Plan{profile,provider}=>{
 let effective=EffectivePolicy{policy:PolicyRef{profile_id:profile.profile_id.clone(),profile_version:profile.profile_version.clone()},scope:AssignmentScope::System,assignment_id:None,assignment_revision:None};
 let adapters=profile.protocols.entries().iter().map(|(_,s)|s.binding.runtime_adapter_id.clone()).collect::<Vec<_>>();
 resolve_plan(effective,&profile,&provider,&adapters).map(|plan|{
 let purposes=plan.purposes.entries().into_iter().map(|(purpose,p)|(purpose.into(),json!({"purpose":purpose,"binding":p.binding,"readiness":p.readiness,"provisioned":p.provisioned,"materializationIds":p.materialization_ids}))).collect::<serde_json::Map<_,_>>();
 json!({"profileId":profile.profile_id,"profileVersion":profile.profile_version,"purposes":purposes})
 })}
 };match result{Ok(v)=>json!({"ok":v}),Err(error)=>json!({"error":error})}
 }).collect();
    println!("{}", serde_json::to_string(&out).unwrap());
}
