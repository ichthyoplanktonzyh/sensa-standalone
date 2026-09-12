import {execFileSync} from 'node:child_process';

const expected=process.env.SENSA_RELEASE_SHA??'';
const actual=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(expected)||actual!==expected)throw Error('Checked-out revision does not match the required full release SHA');
console.log(`Verified release revision ${expected}.`);
