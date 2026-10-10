import {test,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveJourneyEvidence,verifyJourneyEvidence} from '../../../scripts/archiveJourneyEvidence.mts';

test('evidence archive preserves original text and binary bytes without inventing run verdicts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sensa-evidence-archive-'));
 try{
  await mkdir(join(root,'.tmp'));
  const text='LJ-07 independent observation\nfixture@example.invalid\nEarlier FAIL and later PASS remain original observations.\n';
  const binary=Buffer.from([0,1,2,255]);
  await writeFile(join(root,'.tmp/lj07-report.md'),text);
  await writeFile(join(root,'.tmp/lj07-view.png'),binary);
  const output='output/playwright/evidence-archives/unit-sample';
  const manifest=await archiveJourneyEvidence(root,['.tmp/lj07-report.md','.tmp/lj07-view.png'],output,'a'.repeat(40));
  expect(await readFile(join(root,output,'files/.tmp/lj07-report.md'),'utf8')).toBe(text);
  expect(await readFile(join(root,output,'files/.tmp/lj07-view.png'))).toEqual(binary);
  expect(manifest.contentRedacted).toBe(false);
  expect(manifest.entries[0]?.journeyHints).toEqual(['LJ-07']);
  expect(manifest.entries.every(entry=>!('verdict'in entry))).toBe(true);
  expect(await verifyJourneyEvidence(root,output+'/manifest.json')).toEqual({files:2,bytes:Buffer.byteLength(text)+binary.length});
  await expect(archiveJourneyEvidence(root,['.tmp/lj07-report.md'],output)).rejects.toThrow();
  expect(await readFile(join(root,'.tmp/lj07-report.md'),'utf8')).toBe(text);
  await writeFile(join(root,output,'files/.tmp/lj07-view.png'),Buffer.from([3]));
  await expect(verifyJourneyEvidence(root,output+'/manifest.json')).rejects.toThrow(/mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('archives reject traversal, profiles, credential files and symlinks before copying',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sensa-evidence-boundary-'));
 try{
  await mkdir(join(root,'.tmp'));
  await writeFile(join(root,'.tmp/source.md'),'original');
  const output='output/playwright/evidence-archives/unit-boundary';
  for(const source of ['/tmp/other.md','../other.md','.tmp/../other.md','.tmp/.env.real-service','output/playwright/sample/profile/Cookies','.tmp/test-mailbox.json']){
   await expect(archiveJourneyEvidence(root,[source],output)).rejects.toThrow();
  }
  await expect(archiveJourneyEvidence(root,['.tmp/source.md'],'output/playwright')).rejects.toThrow();
  await expect(archiveJourneyEvidence(root,['.tmp/source.md','.tmp/source.md'],output)).rejects.toThrow(/unique/);
  await symlink(join(root,'.tmp/source.md'),join(root,'.tmp/alias.md'));
  await expect(archiveJourneyEvidence(root,['.tmp/alias.md'],output)).rejects.toThrow(/symlink/);
  expect(await readFile(join(root,'.tmp/source.md'),'utf8')).toBe('original');
 }finally{await rm(root,{recursive:true,force:true});}
});
