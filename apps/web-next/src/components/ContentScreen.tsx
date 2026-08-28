import { useState, useEffect } from 'react';
import { noteService } from '../services/noteService';

interface ContentScreenProps {
  active: boolean;
  onGo?: (id: string) => void;
  onBack: () => void;
  toast: (msg: string) => void;
}

export const ContentScreen = ({ active, onGo, onBack, toast }: ContentScreenProps) => {
  const [noteCount, setNoteCount] = useState(() => noteService.getNoteCount());

  useEffect(() => {
    setNoteCount(noteService.getNoteCount());
    const unsub = noteService.subscribe(() => {
      setNoteCount(noteService.getNoteCount());
    });
    return unsub;
  }, []);
  return (
    <section className={`screen${active ? ' active' : ''}`} id="s-content" data-anim="sheet">
      <div className="sheet-head">
        <button className="down" onClick={onBack} aria-label="返回">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <h2>我的内容</h2>
        <button className="right" onClick={() => toast('小窍门：善用随身听，通勤时间也能刷词')}>
          <svg className="icon"><use href="#i-bulb" /></svg>
        </button>
      </div>
      <div className="pad">
        <div className="listen-wrap">
          <div className="lcard a">
            <div className="lc-head">
              <span className="dot"><svg className="icon"><use href="#i-head" /></svg></span>
              <span>随身听</span>
            </div>
            <div className="lc-inner">
              <div className="lbox" onClick={() => toast('随身听 · 回顾：暂无可播放单词')}>
                <div className="n">回顾</div>
                <div className="c">0 词</div>
                <span className="play"><svg className="icon"><use href="#i-play" /></svg></span>
              </div>
              <div className="lbox" onClick={() => toast('随身听 · 预习：开始播放 40 词')}>
                <div className="n">预习</div>
                <div className="c">40 词</div>
                <span className="play"><svg className="icon"><use href="#i-play" /></svg></span>
              </div>
            </div>
          </div>
          <div className="lcard b">
            <div className="lc-head">
              <span className="dot"><svg className="icon"><use href="#i-write" /></svg></span>
              <span>听写</span>
            </div>
            <div className="lc-inner">
              <div className="lbox" onClick={() => toast('听写 · 随堂测：暂无待测单词')}>
                <div className="n">随堂测</div>
                <div className="c">0 词</div>
                <span className="play"><svg className="icon"><use href="#i-play" /></svg></span>
              </div>
            </div>
          </div>
        </div>

        <div className="card group">
          <div
            className="row"
            onClick={() => {
              if (onGo) {
                onGo('s-wordlist');
              } else {
                toast('打开「在学词书」单词表');
              }
            }}
          >
            <span className="sq" style={{ background: '#dff5ee', color: '#13a583' }}>
              <svg className="icon"><use href="#i-bookopen" /></svg>
            </span>
            <span className="t">在学词书</span>
            <span className="v">5585 词</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
        </div>

        <div className="card group">
          <div className="row" onClick={() => toast('近日已学：前天 1 词')}>
            <span className="sq" style={{ background: '#fdf0d8', color: '#e9a020' }}>
              <svg className="icon"><use href="#i-calchk" /></svg>
            </span>
            <span className="t">近日已学</span>
            <span className="v">前天 1 词</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
          <div className="row" onClick={() => toast('全部已学：7234 词')}>
            <span className="sq" style={{ background: '#fdf3dc', color: '#e8a72a' }}>
              <svg className="icon"><use href="#i-chk" /></svg>
            </span>
            <span className="t">全部已学</span>
            <span className="v">7234 词</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
        </div>

        <div className="card group">
          <div className="row" onClick={() => toast('单词本：1 本')}>
            <span className="sq" style={{ background: '#e6ecfd', color: '#4a76e8' }}>
              <svg className="icon"><use href="#i-note" /></svg>
            </span>
            <span className="t">单词本</span>
            <span className="v">1 本</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
          <div className="row" onClick={() => toast('句库：还没有收藏例句')}>
            <span className="sq" style={{ background: '#e6ecfd', color: '#4a76e8' }}>
              <svg className="icon"><use href="#i-quote" /></svg>
            </span>
            <span className="t">句库</span>
            <span className="v">0 句</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
          <div
            className="row"
            onClick={() => {
              const allNotes = noteService.getAllNotes();
              const words = Object.keys(allNotes).filter((k) => !!allNotes[k].trim());
              if (words.length === 0) {
                toast('笔记：还没有写过笔记');
              } else {
                toast(`已为 ${words.join('、')} 记录了专属笔记`);
              }
            }}
          >
            <span className="sq" style={{ background: '#e9edff', color: '#5772ea' }}>
              <svg className="icon"><use href="#i-pen" /></svg>
            </span>
            <span className="t">笔记</span>
            <span className="v">{noteCount} 条</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
        </div>
      </div>
    </section>
  );
};
