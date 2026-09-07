import {useState} from 'react';
import type {AccountContext} from '@sensa/contracts/sensa';
import type {AccountReplica} from '../data/replica/accountStore';
import {checkInDate} from '../data/replica/checkin';
import {clockSample} from '../data/replica/clock';
import {setupButton,setupPrimary} from '../experience/components/learning/LearningSetupFrame';
export function CheckInCalendar({account,replica,onCheckIn,busy}:{account:AccountContext;replica:AccountReplica;onCheckIn:()=>void;busy:boolean}){
 const [month,setMonth]=useState((replica.plan?.accountDate??new Date().toISOString()).slice(0,7));
 const today=clockSample(account.clockGrant)?.occurredAt;const day=today?checkInDate(today,account.timeZone):replica.plan?.accountDate;
 const entries=replica.outbox.filter(x=>x.operation.kind==='check_in.record');
 const pending=(date:string)=>entries.some(x=>x.state==='pending'&&checkInDate(x.operation.occurredAt,account.timeZone)===date);
 const uncertain=entries.some(x=>x.state==='retained'&&x.error==='clock_untrusted');
 const latest=(replica.plan?.accountDate??new Date().toISOString()).slice(0,7);const minimum=new Date(latest+'-01T00:00:00Z');minimum.setUTCMonth(minimum.getUTCMonth()-11);
 const [year,m]=month.split('-').map(Number);const count=new Date(Date.UTC(year!,m!,0)).getUTCDate();const offset=(new Date(Date.UTC(year!,m!-1,1)).getUTCDay()+6)%7;
 function move(delta:number){const date=new Date(Date.UTC(year!,m!-1+delta,1));setMonth(date.toISOString().slice(0,7));}
 return <div className="space-y-4 rounded-2xl border bg-white p-6"><h2 className="text-xl font-semibold">签到日历</h2>
  <p>开始学习也相当于签到。你也可以手动记录今天。</p>
  <button className={setupPrimary} disabled={busy||!!(day&&replica.checkins[day])||!!(day&&pending(day))} onClick={onCheckIn}>{day&&replica.checkins[day]?'今日已签到':day&&pending(day)?'签到待同步':'签到'}</button>
  {uncertain&&<p role="status">有签到时间需要核对。原记录已保留，请联网校准后重新确认今天的签到。</p>}
  <div className="flex items-center justify-between"><button className={setupButton} disabled={month<=minimum.toISOString().slice(0,7)} onClick={()=>move(-1)} aria-label="上个月">←</button><h3>{month}</h3><button className={setupButton} disabled={month>=latest} onClick={()=>move(1)} aria-label="下个月">→</button></div>
  <div role="grid" aria-label={`${month} 签到日历`} className="grid grid-cols-7 gap-1 text-center">{['一','二','三','四','五','六','日'].map(x=><span role="columnheader" key={x} className="py-2 text-sm">{x}</span>)}{Array.from({length:offset},(_,i)=><span key={'blank'+i}/>)}{Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0'),done=!!replica.checkins[date],waiting=pending(date);return <span role="gridcell" aria-label={`${date} ${done?'已签到':waiting?'待同步':'未签到'}`} key={date} className={'rounded-lg py-3 text-sm '+(done?'bg-[#303f76] text-white':waiting?'border border-dashed border-[#303f76]':date===day?'bg-[#edf0f7]':'')}><time dateTime={date}>{i+1}</time></span>;})}</div>
  <p className="text-xs text-[#68748d]">深色为已确认，虚线为待同步。按账号时区 {account.timeZone} 记录。</p>
 </div>;
}
