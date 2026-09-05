import type { Word } from './types';

export const WORDS: Word[] = [
  // COCA 20000 高频词 (与截图 1/2/3 1:1 对齐)
  {
    id: 'w_the',
    w: 'the',
    syl: 'the',
    ph: '/ðə/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'det.', items: ['这，那'] },
    ],
    options: [
      { pos: 'det.', text: '这，那', ok: true },
      { pos: 'n.', text: '他们；她们' },
      { pos: 'v.', text: '存在；是' },
      { pos: 'prep.', text: '在…里面' },
    ],
    sentences: [
      {
        src: '生活大爆炸 S01E01',
        theme: 'bbt',
        en: 'This is <b>the</b> exact solution we were searching for.',
        zh: '这就是我们一直在寻找的确切解法。',
      },
    ],
    total: 20,
    def: '<b>det.</b> used to refer to a person or thing that is known or has already been mentioned 这，那',
    mnemo: {
      '词组搭配': [
        ['the only', '唯一的'],
        ['at the moment', '此刻，眼下'],
      ],
    },
  },
  {
    id: 'w_be',
    w: 'be',
    syl: 'be',
    ph: '/bi/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'vlink.', items: ['有，存在；是'] },
      { pos: 'aux.', items: ['正；被；应当，只得'] },
      { pos: 'vi.', items: ['在；前往'] },
    ],
    options: [
      { pos: 'v.', text: '有，存在；是', ok: true },
      { pos: 'v.', text: '去，前往' },
      { pos: 'v.', text: '拥有，具有' },
      { pos: 'v.', text: '看见，观察' },
    ],
    sentences: [
      {
        src: '老友记 S01E01',
        theme: 'friends',
        en: 'To <b>be</b> or not to <b>be</b>, that is always the question.',
        zh: '生存还是毁灭，这永远是一个值得思考的问题。',
      },
    ],
    total: 30,
    def: '<b>v.</b> to exist or to have a particular quality or feature 有，存在；是',
    mnemo: {
      '词组搭配': [
        ['be able to', '能够做某事'],
        ['be about to', '正要，即将'],
      ],
    },
  },
  {
    id: 'w_and',
    w: 'and',
    syl: 'and',
    ph: '/ænd/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'conj.', items: ['和，与，又；加上；然后；那么'] },
    ],
    options: [
      { pos: 'conj.', text: '和，与，又；加上；然后；那么', ok: true },
      { pos: 'prep.', text: '关于；属于' },
      { pos: 'conj.', text: '或者；否则' },
      { pos: 'conj.', text: '但是；然而' },
    ],
    sentences: [
      {
        src: '摩登家庭 S02E04',
        theme: 'modern',
        en: 'You <b>and</b> I make a truly unbeatable team.',
        zh: '你和我组成了一支真正无坚不摧的队伍。',
      },
    ],
    total: 25,
    def: '<b>conj.</b> also; in addition to 和，与，又；加上；然后；那么',
    mnemo: {
      '词组搭配': [
        ['and so on', '等等'],
        ['again and again', '再三地，反复地'],
      ],
    },
  },
  {
    id: 'w_of',
    w: 'of',
    syl: 'of',
    ph: '/əv/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'prep.', items: ['属于，关于；在，当'] },
    ],
    options: [
      { pos: 'prep.', text: '属于，关于；在，当', ok: true },
      { pos: 'prep.', text: '为了；因为' },
      { pos: 'prep.', text: '在…上面' },
      { pos: 'prep.', text: '通过；由' },
    ],
    sentences: [
      {
        src: '经济学人',
        theme: 'city',
        en: 'The genuine beauty <b>of</b> knowledge lies in constant curiosity.',
        zh: '知识的真正美丽在于永恒的好奇心。',
      },
    ],
    total: 20,
    def: '<b>prep.</b> belonging to or connected with 属于，关于；在，当',
    mnemo: {
      '词组搭配': [
        ['because of', '因为，由于'],
        ['in front of', '在……前面'],
      ],
    },
  },
  {
    id: 'w_a',
    w: 'a',
    syl: 'a',
    ph: '/ə/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'det.', items: ['一 (个)，任何一 (个)'] },
    ],
    options: [
      { pos: 'det.', text: '一 (个)，任何一 (个)', ok: true },
      { pos: 'pron.', text: '所有，一切' },
      { pos: 'prep.', text: '向，朝' },
      { pos: 'v.', text: '有，具备' },
    ],
    sentences: [
      {
        src: '阿甘正传',
        theme: 'forest',
        en: 'Life is like <b>a</b> marvelous box of assorted chocolates.',
        zh: '生活就像一盒奇妙的什锦巧克力。',
      },
    ],
    total: 18,
    def: '<b>det.</b> used before a noun to refer to one thing or person 一 (个)，任何一 (个)',
    mnemo: {
      '词组搭配': [
        ['a lot of', '大量的，许多'],
        ['a little bit', '一点点'],
      ],
    },
  },
  {
    id: 'w_in',
    w: 'in',
    syl: 'in',
    ph: '/ɪn/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'prep.', items: ['在…某一点；在…之中；进入'] },
    ],
    options: [
      { pos: 'prep.', text: '在…某一点；在…之中；进入', ok: true },
      { pos: 'prep.', text: '在…之后' },
      { pos: 'prep.', text: '离开，远离' },
      { pos: 'prep.', text: '在…下方' },
    ],
    sentences: [
      {
        src: '老友记 S02E12',
        theme: 'friends',
        en: 'We are all <b>in</b> this memorable journey together.',
        zh: '我们大家在这趟难忘的旅程中休戚与共。',
      },
    ],
    total: 22,
    def: '<b>prep.</b> inside or within 在…某一点；在…之中；进入',
    mnemo: {
      '词组搭配': [
        ['in advance', '提前，预先'],
        ['in case of', '万一，假使'],
      ],
    },
  },
  {
    id: 'w_to',
    w: 'to',
    syl: 'to',
    ph: '/tuː/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'prep.', items: ['向，往；到；对；为了'] },
    ],
    options: [
      { pos: 'prep.', text: '向，往；到；对；为了', ok: true },
      { pos: 'prep.', text: '从…出发' },
      { pos: 'prep.', text: '关于…' },
      { pos: 'prep.', text: '因为…' },
    ],
    sentences: [
      {
        src: '神探夏洛克 S01E01',
        theme: 'sherlock',
        en: 'Pay close attention <b>to</b> every single detail.',
        zh: '对每一个细微的线索都要密切关注。',
      },
    ],
    total: 24,
    def: '<b>prep.</b> in the direction of 向，往；到；对；为了',
    mnemo: {
      '词组搭配': [
        ['to the point', '切中要害'],
        ['to and fro', '来回往返'],
      ],
    },
  },
  {
    id: 'w_have',
    w: 'have',
    syl: 'have',
    ph: '/hæv/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'v.', items: ['有，拥有；经受；吃，喝'] },
      { pos: 'aux.', items: ['已经 (完成时助动词)'] },
    ],
    options: [
      { pos: 'v.', text: '有，拥有；经受；吃，喝', ok: true },
      { pos: 'v.', text: '给予，赠送' },
      { pos: 'v.', text: '拿起，获取' },
      { pos: 'v.', text: '创造，制造' },
    ],
    sentences: [
      {
        src: '生活大爆炸 S03E18',
        theme: 'bbt',
        en: 'We <b>have</b> an unbelievable amount of research left to conduct.',
        zh: '我们还有大量令人难以置信的研究需要进行。',
      },
    ],
    total: 25,
    def: '<b>v.</b> to own, hold, or experience 有，拥有；经受；吃，喝',
    mnemo: {
      '词组搭配': [
        ['have in mind', '心目中已有考虑'],
        ['have no choice', '别无选择'],
      ],
    },
  },
  {
    id: 'w_it',
    w: 'it',
    syl: 'it',
    ph: '/ɪt/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'pron.', items: ['它；这，那；(作形式主语/宾语)'] },
    ],
    options: [
      { pos: 'pron.', text: '它；这，那', ok: true },
      { pos: 'pron.', text: '他们，她们' },
      { pos: 'pron.', text: '你，你们' },
      { pos: 'pron.', text: '我们大家' },
    ],
    sentences: [
      {
        src: '老友记 S03E01',
        theme: 'friends',
        en: '<b>It</b> was honestly the best timing we could hope for.',
        zh: '说实话，这是我们所能期望的最佳时机了。',
      },
    ],
    total: 20,
    def: '<b>pron.</b> used to refer to a thing previously mentioned 它；这，那',
    mnemo: {
      '词组搭配': [
        ['make it', '成功；准时到达'],
        ['take it easy', '放轻松'],
      ],
    },
  },
  {
    id: 'w_I',
    w: 'I',
    syl: 'I',
    ph: '/aɪ/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'pron.', items: ['我'] },
    ],
    options: [
      { pos: 'pron.', text: '我', ok: true },
      { pos: 'pron.', text: '你' },
      { pos: 'pron.', text: '他' },
      { pos: 'pron.', text: '她' },
    ],
    sentences: [
      {
        src: '阿甘正传',
        theme: 'forest',
        en: '<b>I</b> will always remember the kindness you showed me.',
        zh: '我将永远记住你给予我的友善。',
      },
    ],
    total: 15,
    def: '<b>pron.</b> the person who is speaking or writing 我',
    mnemo: {
      '词组搭配': [
        ['I see', '我明白了'],
        ['I suppose so', '我想是这样吧'],
      ],
    },
  },
  {
    id: 'w_that',
    w: 'that',
    syl: 'that',
    ph: '/ðæt/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'det./pron.', items: ['那，那个；那件事'] },
      { pos: 'conj.', items: ['引导从句'] },
    ],
    options: [
      { pos: 'det./pron.', text: '那，那个；那件事', ok: true },
      { pos: 'det.', text: '这，这个' },
      { pos: 'pron.', text: '什么东西' },
      { pos: 'pron.', text: '哪一个' },
    ],
    sentences: [
      {
        src: '生活大爆炸 S04E10',
        theme: 'bbt',
        en: '<b>That</b> experiment clearly proved our original hypothesis.',
        zh: '那个实验清晰地证实了我们最初的假设。',
      },
    ],
    total: 22,
    def: '<b>det./pron.</b> used to point out a specific person or thing 那，那个；那件事',
    mnemo: {
      '词组搭配': [
        ['that is to say', '也就是说，换句话说'],
        ['now that', '既然，由于'],
      ],
    },
  },
  {
    id: 'w_you',
    w: 'you',
    syl: 'you',
    ph: '/juː/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'pron.', items: ['你，你们'] },
    ],
    options: [
      { pos: 'pron.', text: '你，你们', ok: true },
      { pos: 'pron.', text: '我自己' },
      { pos: 'pron.', text: '他们大家' },
      { pos: 'pron.', text: '谁人' },
    ],
    sentences: [
      {
        src: '老友记 S02E15',
        theme: 'friends',
        en: '<b>You</b> always know exactly what to say to lift my spirits.',
        zh: '你总是知道该说些什么来鼓舞我的心情。',
      },
    ],
    total: 20,
    def: '<b>pron.</b> used to refer to the person or people being addressed 你，你们',
    mnemo: {
      '词组搭配': [
        ['you bet', '当然，必定'],
        ['you are welcome', '不客气'],
      ],
    },
  },
  {
    id: 'w_for',
    w: 'for',
    syl: 'for',
    ph: '/fɔːr/',
    tags: ['COCA', '高频', '核心'],
    senses: [
      { pos: 'prep.', items: ['为了；给；代表；持续'] },
      { pos: 'conj.', items: ['因为'] },
    ],
    options: [
      { pos: 'prep.', text: '为了；给；代表；持续', ok: true },
      { pos: 'prep.', text: '关于…' },
      { pos: 'prep.', text: '在…旁边' },
      { pos: 'prep.', text: '从…出发' },
    ],
    sentences: [
      {
        src: '经济学人',
        theme: 'city',
        en: 'Sustainable development is vital <b>for</b> our shared future.',
        zh: '可持续发展对于我们共同的未来至关重要。',
      },
    ],
    total: 20,
    def: '<b>prep.</b> with the purpose of or intended to belong to 为了；给；代表；持续',
    mnemo: {
      '词组搭配': [
        ['for instance', '例如，举例来说'],
        ['for the sake of', '为了……起见'],
      ],
    },
  },

  // 0. folk (1:1 with user uploaded screenshot - 端午节)
  {
    id: 'w_folk',
    w: 'folk',
    syl: 'folk',
    ph: '/fəʊk/',
    tags: ['CET-4', '考研', '核心'],
    senses: [
      { pos: 'adj.', items: ['民间的，民俗的', '民谣的'] },
      { pos: 'n.', items: ['人们', '各位，大伙儿', '家人，父母'] },
    ],
    senseDetails: [
      {
        pos: 'adj.',
        text: '民间的，民俗的',
        tag: '核心',
        def: '<b>adj.</b> traditional and typical of the ordinary people of a country or community 民间的，民俗的',
        pattern: '[only before noun]',
        sentences: [
          {
            src: '端午节',
            theme: 'duanwu',
            en: 'These <b>folk</b> customs have history going back at least 400 years.',
            zh: '这些民间习俗至少有四百年的历史了。',
          },
          {
            src: '中国传统节日',
            theme: 'duanwu',
            en: 'Dragon boat racing is a vibrant <b>folk</b> tradition celebrated across China.',
            zh: '赛龙舟是一项在全中国庆祝的充满活力的民俗传统。',
          },
          {
            src: '文化地理',
            theme: 'forest',
            en: 'Local <b>folk</b> tales have been passed down from generation to generation.',
            zh: '当地的民间故事代代相传。',
          },
          {
            src: '国家地理',
            theme: 'city',
            en: 'The museum showcases ancient <b>folk</b> art and craftworks.',
            zh: '该博物馆展示了古代民间艺术和手工艺品。',
          },
          {
            src: '非遗传承',
            theme: 'duanwu',
            en: 'Ancient <b>folk</b> melodies were recorded to preserve cultural heritage.',
            zh: '录制古老民谣以保护文化遗产。',
          },
          {
            src: '民俗博览 S01',
            theme: 'duanwu',
            en: 'Traditional <b>folk</b> medicine played an important role in early history.',
            zh: '传统民间医学在早期历史上扮演了重要角色。',
          },
        ],
      },
      {
        pos: 'adj.',
        text: '民谣的',
        tag: '常考',
        def: '<b>adj.</b> in the style of traditional popular music 民谣的，民间音乐风格的',
        pattern: '[music style]',
        sentences: [
          {
            src: '爱乐之城',
            theme: 'night',
            en: 'She played a gentle <b>folk</b> song on her acoustic guitar.',
            zh: '她用原声吉他弹奏了一首温柔的民谣。',
          },
          {
            src: '音乐节',
            theme: 'sky',
            en: 'The indie <b>folk</b> band captivated the audience under the starry night.',
            zh: '这支独立民谣乐队在繁星点点的夜空下吸引了全场观众。',
          },
        ],
      },
      {
        pos: 'n.',
        text: '人们',
        tag: '常用',
        def: '<b>n.</b> people in general 人们',
        pattern: '[plural]',
        sentences: [
          {
            src: '生活大爆炸 S02E10',
            theme: 'bbt',
            en: 'Some <b>folk</b> just do not appreciate theoretical physics.',
            zh: '有些人就是不懂得欣赏理论物理。',
          },
        ],
      },
      {
        pos: 'n.',
        text: '各位，大伙儿',
        tag: '口语',
        def: '<b>n.</b> used when talking to two or more people in a friendly way 各位，大伙儿',
        pattern: '[informal, vocative]',
        sentences: [
          {
            src: '老友记 S01E01',
            theme: 'friends',
            en: 'Well, <b>folks</b>, that concludes tonight’s show!',
            zh: '好了大伙儿，今晚的演出就到此结束啦！',
          },
        ],
      },
      {
        pos: 'n.',
        text: '家人，父母',
        tag: '拓展',
        def: '<b>n.</b> a person’s parents or family 家人，父母，亲属',
        pattern: '[plural, informal]',
        sentences: [
          {
            src: '摩登家庭 S01E03',
            theme: 'modern',
            en: 'I am going back home to visit my <b>folks</b> this weekend.',
            zh: '我这个周末要回家看望我的父母。',
          },
        ],
      },
    ],
    options: [
      { pos: 'adj.', text: '民间的，民俗的；人们', ok: true },
      { pos: 'v.', text: '折叠；翻转；弯曲' },
      { pos: 'n.', text: '森林；树林；木材' },
      { pos: 'adj.', text: '锋利的；敏锐的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '民间的；人们', ok: true },
      { pos: 'v.', text: '叉起；分叉' }, // fork
      { pos: 'n.', text: '羊群；一群' }, // flock
      { pos: 'v.', text: '专注；聚焦' }, // focus
    ],
    sentences: [
      {
        src: '端午节',
        theme: 'duanwu',
        en: 'These <b>folk</b> customs have history going back at least 400 years.',
        zh: '这些民间习俗至少有四百年的历史了。',
      },
    ],
    total: 42,
    def: '<b>adj.</b> traditional and typical of the ordinary people of a country or community 民间的，民俗的',
    mnemo: {
      '词组搭配': [
        ['folk customs', '民俗，民间习俗'],
        ['folk music', '民间音乐，民谣'],
        ['folk art', '民间艺术'],
        ['country folk', '乡下人'],
      ],
      '派生': [
        ['folklore', 'n. 民间传说，民俗学'],
        ['folksy', 'adj. 有民间风味的，亲切的'],
      ],
      '近义': [
        ['traditional', 'adj. 传统的'],
        ['customary', 'adj. 习惯的，风俗的'],
      ],
    },
  },
  // 1. competition (1:1 with user screenshot)
  {
    id: 'w_competition',
    w: 'competition',
    syl: 'com·pe·ti·tion',
    ph: '/ˌkɒm.pəˈtɪʃ.ən/',
    tags: ['CET-4', '考研', '核心'],
    senses: [
      { pos: 'n.', items: ['竞争', '比赛，竞赛', '竞争对手'] },
    ],
    senseDetails: [
      {
        pos: 'n.',
        text: '竞争',
        tag: '核心',
        def: '<b>n.</b> the process of trying to win or do better than others 竞争',
        pattern: '~ (between/with sb) (for sth)',
        sentences: [
          {
            src: '识骨寻踪',
            theme: 'bones',
            en: 'Sometimes <b>intense competition</b> for limited resources results in violence.',
            zh: '有时对有限资源的激烈竞争会导致暴力行为。',
          },
          {
            src: '生活大爆炸 S04E15',
            theme: 'bbt',
            en: 'The fierce <b>competition</b> between the universities pushed both teams to excel.',
            zh: '大学之间的激烈竞争促使两支队伍都表现出色。',
          },
          {
            src: '经济学人',
            theme: 'city',
            en: 'Healthy market <b>competition</b> often benefits consumers by driving down prices.',
            zh: '健康的良性市场竞争往往通过拉低物价使消费者受益。',
          },
        ],
      },
      {
        pos: 'n.',
        text: '比赛，竞赛',
        tag: '常考',
        def: '<b>n.</b> an event in which people compete with each other to see who is the best 比赛，竞赛',
        pattern: '~ (in sth)',
        sentences: [
          {
            src: '老友记 S03E09',
            theme: 'friends',
            en: 'Monica was determined to win the annual Thanksgiving touch-football <b>competition</b>.',
            zh: '莫妮卡决心赢得一年一度的感恩节腰旗橄榄球比赛。',
          },
          {
            src: '摩登家庭 S02E11',
            theme: 'modern',
            en: 'Manny entered a local school chess <b>competition</b> and took first place.',
            zh: '曼尼参加了当地的学校国际象棋比赛并获得第一名。',
          },
        ],
      },
      {
        pos: 'n.',
        text: '竞争对手',
        tag: '延伸',
        def: '<b>n.</b> the person or people with whom one is competing 竞争对手，竞争者（总称）',
        pattern: '[U, singular]',
        sentences: [
          {
            src: '神探夏洛克 S01E02',
            theme: 'sherlock',
            en: 'We must eliminate any unfair advantage the <b>competition</b> might possess.',
            zh: '我们必须消除竞争对手可能拥有的任何不当优势。',
          },
        ],
      },
    ],
    options: [
      { pos: 'n.', text: '竞争；比赛；竞争对手', ok: true },
      { pos: 'n.', text: '合作；协作；配合' },
      { pos: 'n.', text: '交流；沟通；联系' },
      { pos: 'n.', text: '决定；决议；判定' },
    ],
    audioOptions: [
      { pos: 'n.', text: '竞争；比赛', ok: true },
      { pos: 'n.', text: '完成；结束' }, // completion
      { pos: 'n.', text: '组成；成分' }, // composition
      { pos: 'n.', text: '复杂；混乱' }, // complication
    ],
    sentences: [
      {
        src: '识骨寻踪',
        theme: 'bones',
        en: 'Sometimes <b>intense competition</b> for limited resources results in violence.',
        zh: '有时对有限资源的激烈竞争会导致暴力行为。',
      },
      {
        src: '生活大爆炸 S04E15',
        theme: 'bbt',
        en: 'The fierce <b>competition</b> between the universities pushed both teams to excel.',
        zh: '大学之间的激烈竞争促使两支队伍都表现出色。',
      },
      {
        src: '老友记 S03E09',
        theme: 'friends',
        en: 'Monica was determined to win the annual Thanksgiving touch-football <b>competition</b>.',
        zh: '莫妮卡决心赢得一年一度的感恩节腰旗橄榄球比赛。',
      },
    ],
    total: 36,
    def: '<b>n.</b> the process of trying to win or do better than others 竞争',
    mnemo: {
      '词组搭配': [
        ['fierce competition', '激烈的竞争'],
        ['in competition with', '与……竞争'],
        ['face competition', '面临竞争'],
        ['enter a competition', '参加比赛'],
      ],
      '词根': [
        ['com- 共同 + pet- 寻求，争取', '源自拉丁语 competere（共同争取、竞争）'],
        ['compete v.', '竞争，对抗'],
        ['competitive adj.', '竞争激烈的；好胜的'],
        ['competitor n.', '竞争对手，参赛者'],
      ],
      '派生': [
        ['competence n.', '能力，胜任'],
        ['incompetent adj.', '不胜任的，无能的'],
      ],
      '近义': [
        ['contest n.', '比赛，竞赛'],
        ['rivalry n.', '竞争，敌对状态'],
        ['tournament n.', '锦标赛，联赛'],
      ],
    },
  },

  // 1. river
  {
    id: 'w_river',
    w: 'river',
    syl: 'ri·ver',
    ph: '/ˈrɪv.ər/',
    tags: ['CET-4', '核心'],
    senses: [
      { pos: 'n.', items: ['河，江', '巨流，涌流'] },
    ],
    senseDetails: [
      {
        pos: 'n.',
        text: '河，江',
        tag: '核心',
        def: 'river /ˈrɪv.ər/ n. a natural wide flow of fresh water across the land into the sea, a lake, or another river 江，河，水道。例：They crossed the river by boat. 他们乘船过了河。',
        pattern: '~ (across/along/down/up sth)',
        sentences: [
          {
            src: '生活大爆炸 S04E12',
            theme: 'bbt',
            en: 'The whole university campus is located right by the Charles <b>River</b>.',
            zh: '整座大学校园就坐落在查尔斯河畔。',
          },
          {
            src: '老友记 S01E02',
            theme: 'friends',
            en: 'The <b>river</b> flows gently through the quiet valley.',
            zh: '河流缓缓流过宁静的山谷。',
          },
          {
            src: '阿甘正传',
            theme: 'forest',
            en: 'We were always looking for this guy named Charlie in the <b>river</b>.',
            zh: '我们总是在河里寻找一个叫查理的家伙。',
          },
          {
            src: '摩登家庭 S02E08',
            theme: 'modern',
            en: 'We rented a small wooden cabin right along the Colorado <b>River</b>.',
            zh: '我们在科罗拉多河边租了一间小木屋。',
          },
          {
            src: '神探夏洛克 S01E02',
            theme: 'sherlock',
            en: 'The body was discovered downstream along the Thames <b>River</b>.',
            zh: '尸体是在泰晤士河下游被发现的。',
          },
        ],
      },
      {
        pos: 'n.',
        text: '巨流，涌流',
        def: 'river /ˈrɪv.ər/ n. a large amount of liquid or a large number of things or people moving together 巨流，大量的涌流。例：A river of molten lava poured down the mountain. 一股熔岩巨流倾泻而下。',
        pattern: 'a river of sth',
        sentences: [
          {
            src: '生活大爆炸 S07E03',
            theme: 'bbt',
            en: 'There was a <b>river</b> of molten cheese running across the kitchen counter.',
            zh: '厨房柜台上流淌着一股融化芝士的涌流。',
          },
          {
            src: '国家地理',
            theme: 'night',
            en: 'At dawn, a winding <b>river</b> of mist rises from the surface of the canyon.',
            zh: '黎明时分，峡谷上升起一道蜿蜒的薄雾巨流。',
          },
          {
            src: 'BBC 纪录片',
            theme: 'forest',
            en: 'Hundreds of species depend on this mighty living <b>river</b> for survival.',
            zh: '数以百计的物种依赖这条雄伟的生命巨流繁衍生息。',
          },
        ],
      },
    ],
    options: [
      { pos: 'n.', text: '河，江', ok: true },
      { pos: 'n.', text: '道路，途径' },
      { pos: 'n.', text: '森林，丛林' },
      { pos: 'n.', text: '山脉，高山' },
    ],
    audioOptions: [
      { pos: 'n.', text: '河，江', ok: true },
      { pos: 'n.', text: '骑行，乘车' }, // ride
      { pos: 'n.', text: '米饭，稻米' }, // rice
      { pos: 'n.', text: '作家，作者' }, // writer
    ],
    sentences: [
      {
        src: '生活大爆炸 S04E12',
        theme: 'bbt',
        en: 'The whole university campus is located right by the Charles <b>River</b>.',
        zh: '整座大学校园就坐落在查尔斯河畔。',
      },
      {
        src: '老友记 S01E02',
        theme: 'friends',
        en: 'The <b>river</b> flows gently through the quiet valley.',
        zh: '河流缓缓流过宁静的山谷。',
      },
      {
        src: 'BBC 纪录片',
        theme: 'forest',
        en: 'Hundreds of species depend on this mighty <b>river</b> for survival.',
        zh: '数百种生物依赖这条雄伟的大河繁衍生息。',
      },
      {
        src: '国家地理',
        theme: 'night',
        en: 'At dawn, mist rises from the surface of the winding <b>river</b>.',
        zh: '黎明时分，蜿蜒的江面上升起缕缕薄雾。',
      },
    ],
    total: 20,
    def: 'river /ˈrɪv.ər/ n. a natural wide flow of fresh water across the land into the sea, a lake, or another river 江，河，水道。例：They crossed the river by boat. 他们乘船过了河。',
    mnemo: {
      '词组搭配': [
        ['cross the river', '过河'],
        ['river bank', '河岸'],
        ['up the river', '逆流而上；入狱'],
        ['down the river', '顺流而下；被出卖'],
      ],
      '词根': [
        ['riv- 河流', '源自拉丁语 rivus（溪流），引申为两岸对立竞争'],
        ['rival n./v.', '竞争对手（原意为争夺同一水源的人）'],
        ['derive v.', '源于，导出（de- 离开 + riv- 溪流）'],
      ],
      '派生': [
        ['riverfront n.', '沿河地区，临河地带'],
        ['riverbed n.', '河床'],
      ],
      '近义': [
        ['stream n.', '小河，溪流'],
        ['creek n.', '小溪，小河'],
        ['brook n.', '溪流'],
      ],
    },
  },

  // 2. settle
  {
    id: 'w_settle',
    w: 'settle',
    syl: 'set·tle',
    ph: '/ˈset.əl/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'v.', items: ['解决 (分歧/纠纷)', '定居；安家'] },
    ],
    senseDetails: [
      {
        pos: 'v.',
        text: '解决 (分歧/纠纷)',
        tag: '核心',
        def: 'settle /ˈset.əl/ v. to reach an agreement about or end a disagreement 解决，调停，和解。例：They settled the argument over dinner. 他们在晚餐时解决了争论。',
        pattern: '~ (a dispute/matter/issue)',
        sentences: [
          {
            src: '生活大爆炸 S03E09',
            theme: 'bbt',
            en: 'Let us <b>settle</b> this like men: rock, paper, scissors, lizard, Spock.',
            zh: '让我们像男人一样解决：剪刀石头布蜥蜴斯波克。',
          },
          {
            src: '老友记 S03E09',
            theme: 'friends',
            en: 'They finally managed to <b>settle</b> all the arguments over dinner.',
            zh: '他们终于在晚餐时解决了所有的争论。',
          },
          {
            src: '经济学人',
            theme: 'city',
            en: 'The court urged both companies to <b>settle</b> the patent dispute out of court.',
            zh: '法院督促两家公司在庭外和解专利纠纷。',
          },
        ],
      },
      {
        pos: 'v.',
        text: '定居；安家',
        def: 'settle /ˈset.əl/ v. to go and live in a new place permanently 定居，安家。例：Many immigrants chose to settle in the coastal regions. 许多移民选择在沿海地区定居。',
        pattern: '~ (down) (in/at sth)',
        sentences: [
          {
            src: '摩登家庭 S01E04',
            theme: 'modern',
            en: 'After years of traveling, they finally decided to <b>settle</b> down in California.',
            zh: '漂泊多年后，他们终于决定在加州定居安家。',
          },
          {
            src: 'BBC 新闻',
            theme: 'forest',
            en: 'Many immigrants chose to <b>settle</b> in the fertile coastal regions.',
            zh: '许多移民选择在肥沃的沿海地区定居。',
          },
          {
            src: '阿甘正传',
            theme: 'sky',
            en: 'You have to put the past behind you before you can <b>settle</b> your mind.',
            zh: '你必须放下过去，才能安下心来过日子。',
          },
        ],
      },
    ],
    options: [
      { pos: 'v.', text: '解决；定居；平息', ok: true },
      { pos: 'v.', text: '设置；建立；树立' },
      { pos: 'v.', text: '分离；分开；挑选' },
      { pos: 'v.', text: '摇摆；犹豫；颤抖' },
    ],
    audioOptions: [
      { pos: 'v.', text: '解决；定居', ok: true },
      { pos: 'n.', text: '鞍座，车座' }, // saddle
      { pos: 'adj.', text: '微妙的，不易察觉的' }, // subtle
      { pos: 'n.', text: '水壶，烧水壶' }, // kettle
    ],
    sentences: [
      {
        src: '生活大爆炸 S03E09',
        theme: 'bbt',
        en: 'Let us <b>settle</b> this like men: rock, paper, scissors, lizard, Spock.',
        zh: '让我们像男人一样解决：剪刀石头布蜥蜴斯波克。',
      },
      {
        src: '老友记 S03E09',
        theme: 'friends',
        en: 'They finally managed to <b>settle</b> all the arguments over dinner.',
        zh: '他们终于在晚餐时解决了所有的争论。',
      },
      {
        src: '经济学人',
        theme: 'city',
        en: 'The court urged both companies to <b>settle</b> the patent dispute out of court.',
        zh: '法院督促两家公司在庭外和解专利纠纷。',
      },
      {
        src: 'BBC 新闻',
        theme: 'forest',
        en: 'Many immigrants chose to <b>settle</b> in the fertile coastal regions.',
        zh: '许多移民选择在肥沃的沿海地区定居。',
      },
    ],
    total: 35,
    def: 'settle /ˈset.əl/ v. to reach an agreement about sth; to go and live in a new place 解决；定居；结清。例：It\'s all settled then. 那就全部定下来了。',
    mnemo: {
      '词组搭配': [
        ['settle down', '定居；安下心来'],
        ['settle a dispute', '调解争端'],
        ['settle for', '勉强接受，将就'],
        ['settle the bill', '结账'],
      ],
      '词根': [
        ['set- 坐下，放置', '源自古英语 setlan（使就座、固定）'],
        ['settler n.', '移居者，殖民者'],
        ['settlement n.', '定居点；协议；和解'],
      ],
      '派生': [
        ['unsettled adj.', '未定的；心神不宁的'],
        ['resettle v.', '重新定居，迁徙'],
      ],
      '近义': [
        ['resolve v.', '解决，消除'],
        ['reside v.', '居住，定居'],
        ['colonize v.', '开拓殖民地'],
      ],
    },
  },

  // 3. protection
  {
    id: 'w_protection',
    w: 'protection',
    syl: 'pro·tec·tion',
    ph: '/prəˈtek.ʃən/',
    tags: ['CET-4', '高频'],
    senses: [
      { pos: 'n.', items: ['保护，防卫', '保护物，防护套', '保护费 (口语)'] },
    ],
    options: [
      { pos: 'n.', text: '保护，防护', ok: true },
      { pos: 'n.', text: '生产，制造' },
      { pos: 'n.', text: '投射，投影' },
      { pos: 'n.', text: '抗议，反对' },
    ],
    audioOptions: [
      { pos: 'n.', text: '保护，防卫', ok: true },
      { pos: 'n.', text: '生产，产量' }, // production
      { pos: 'n.', text: '预测，预报' }, // prediction
      { pos: 'n.', text: '投射，投影' }, // projection
    ],
    sentences: [
      {
        src: '国家地理纪录片',
        theme: 'forest',
        en: 'The thick shell provides excellent <b>protection</b> against predators.',
        zh: '坚硬的外壳为抵御捕食者提供了极佳的保护。',
      },
      {
        src: '卫报',
        theme: 'sky',
        en: 'Environmental laws offer legal <b>protection</b> for endangered species.',
        zh: '环境法律为濒危物种提供了法律层面的保护。',
      },
    ],
    total: 28,
    def: 'protection /prəˈtek.ʃən/ n. the act of protecting sb/sth; the state of being protected 保护，防护。',
    mnemo: {
      '词组搭配': [
        ['environmental protection', '环境保护'],
        ['under the protection of', '在…的庇护下'],
        ['data protection', '数据隐私保护'],
      ],
      '词根': [
        ['pro- 向前 + tect- 覆盖，遮盖', '在前方遮盖挡住危险 → 保护'],
        ['protect v.', '保护，保卫'],
        ['protective adj.', '防御性的，关切保护的'],
      ],
      '近义': [
        ['shield n./v.', '盾牌，庇护'],
        ['defense n.', '防御，保卫'],
        ['safeguard n./v.', '安全保障'],
      ],
    },
  },

  // 4. negotiate
  {
    id: 'w_negotiate',
    w: 'negotiate',
    syl: 'ne·go·ti·ate',
    ph: '/nəˈɡoʊ.ʃi.eɪt/',
    tags: ['CET-6', '考研', '商务英语'],
    senses: [
      { pos: 'v.', items: ['谈判，协商', '商定，达成协议', '顺利通过 (弯道/险阻)'] },
    ],
    options: [
      { pos: 'v.', text: '谈判，协商；商定', ok: true },
      { pos: 'v.', text: '忽略，忽视；疏忽' },
      { pos: 'v.', text: '领航，导航；操纵' },
      { pos: 'v.', text: '通知，告知；通告' },
    ],
    audioOptions: [
      { pos: 'v.', text: '谈判，协商', ok: true },
      { pos: 'v.', text: '领航，导航' }, // navigate
      { pos: 'v.', text: '否定，取消' }, // negate
      { pos: 'v.', text: '通知，公布' }, // notify
    ],
    sentences: [
      {
        src: '纸牌屋 S02E05',
        theme: 'city',
        en: 'We are in a strong position to <b>negotiate</b> a favorable trade deal.',
        zh: '我们在谈判有利的贸易协定中处于十分强劲的地位。',
      },
      {
        src: '金融时报',
        theme: 'night',
        en: 'Diplomats worked tirelessly to <b>negotiate</b> a peaceful ceasefire.',
        zh: '外交官们不知疲倦地通过谈判寻求和平停火。',
      },
    ],
    total: 30,
    def: 'negotiate /nəˈɡoʊ.ʃi.eɪt/ v. to try to reach an agreement by formal discussion 谈判，协商。',
    mnemo: {
      '词组搭配': [
        ['negotiate with sb', '与某人谈判'],
        ['negotiate a treaty', '商定条约'],
        ['negotiate terms', '商定具体条款'],
      ],
      '词根': [
        ['neg- 不 + otium 空闲', '没有闲暇，忙于公务与商谈 → 谈判'],
        ['negotiation n.', '商务谈判，磋商'],
        ['negotiable adj.', '可协商的，可兑现的'],
      ],
      '近义': [
        ['bargain v.', '讨价还价'],
        ['consult v.', '商议，咨询'],
        ['confer v.', '商讨，交换意见'],
      ],
    },
  },

  // 5. fragile
  {
    id: 'w_fragile',
    w: 'fragile',
    syl: 'fra·gile',
    ph: '/ˈfrædʒ.əl/',
    tags: ['CET-6', '考研', '雅思/托福'],
    senses: [
      { pos: 'adj.', items: ['易碎的，脆的', '脆弱的，虚弱的', '微弱的，纤细的'] },
    ],
    options: [
      { pos: 'adj.', text: '易碎的；脆弱的', ok: true },
      { pos: 'adj.', text: '敏捷的；灵活的' },
      { pos: 'adj.', text: '肥沃的；富饶的' },
      { pos: 'adj.', text: '易怒的；狂暴的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '易碎的，脆弱的', ok: true },
      { pos: 'adj.', text: '敏捷的，灵活的' }, // agile
      { pos: 'adj.', text: '易燃的，可燃的' }, // flammable
      { pos: 'adj.', text: '徒劳的，无益的' }, // futile
    ],
    sentences: [
      {
        src: '唐顿庄园 S04E01',
        theme: 'night',
        en: 'Her emotional state was exceedingly <b>fragile</b> after the tragedy.',
        zh: '悲剧发生之后，她的情绪状态极度脆弱。',
      },
      {
        src: '经济学人',
        theme: 'sky',
        en: 'The recovery of the global supply chain remains remarkably <b>fragile</b>.',
        zh: '全球供应链的复苏依然显得格外脆弱。',
      },
    ],
    total: 22,
    def: 'fragile /ˈfrædʒ.əl/ adj. easily broken or damaged; weak and delicate 易碎的；虚弱脆弱的。',
    mnemo: {
      '词组搭配': [
        ['fragile ecosystem', '脆弱的生态系统'],
        ['fragile peace', '脆弱的和平'],
        ['fragile handle with care', '易碎物品，小心轻放'],
      ],
      '词根': [
        ['frag- / fract- 打破，破碎', '一击即碎的 → 脆弱的'],
        ['fragment n.', '碎片，破片'],
        ['fraction n.', '小部分，分数'],
      ],
      '近义': [
        ['delicate adj.', '精细的，易损的'],
        ['vulnerable adj.', '易受攻击的，脆弱的'],
        ['brittle adj.', '硬而脆的'],
      ],
    },
  },

  // 6. commit
  {
    id: 'w_commit',
    w: 'commit',
    syl: 'com·mit',
    ph: '/kəˈmɪt/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'v.', items: ['犯 (错误/罪行)', '承诺，保证', '投入 (资金/时间)', '托付，交付'] },
    ],
    options: [
      { pos: 'v.', text: '犯(罪)；承诺；投入', ok: true },
      { pos: 'v.', text: '提交；服从；呈递' },
      { pos: 'v.', text: '省略；删去；遗漏' },
      { pos: 'v.', text: '发射；散发；发行' },
    ],
    audioOptions: [
      { pos: 'v.', text: '犯(罪)；承诺', ok: true },
      { pos: 'v.', text: '提交，屈服' }, // submit
      { pos: 'v.', text: '允许，准许' }, // permit
      { pos: 'v.', text: '发射，传导' }, // transmit
    ],
    sentences: [
      {
        src: '神探夏洛克 S01E03',
        theme: 'city',
        en: 'He did not <b>commit</b> the crime he was accused of.',
        zh: '他并没有犯下被指控的那桩罪行。',
      },
      {
        src: '纽约时报',
        theme: 'night',
        en: 'The government pledged to <b>commit</b> billions to green energy.',
        zh: '政府宣誓将投入数十亿美元于绿色清洁能源。',
      },
    ],
    total: 32,
    def: 'commit /kəˈmɪt/ v. to do sth wrong or illegal; to promise or give your loyalty to 犯(错误)；承诺；调配投入。',
    mnemo: {
      '词组搭配': [
        ['commit a crime', '犯罪'],
        ['commit suicide', '自杀'],
        ['commit oneself to', '致力于，投身于'],
        ['commit to memory', '牢记在心'],
      ],
      '词根': [
        ['com- 共同 + mit- 发送，送出', '把全部力量托付送出 → 投入，承诺'],
        ['commitment n.', '承诺，担当，奉献'],
        ['committee n.', '委员会'],
      ],
      '近义': [
        ['perpetrate v.', '犯(罪)，做(恶)'],
        ['pledge v.', '誓约，保证'],
        ['devote v.', '奉献，投入'],
      ],
    },
  },

  // 7. abandon
  {
    id: 'w_abandon',
    w: 'abandon',
    syl: 'a·ban·don',
    ph: '/əˈbændən/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'vt.', items: ['放弃，抛弃', '遗弃 (某人)', '放纵，沉溺'] },
      { pos: 'n.', items: ['放任，狂热'] },
    ],
    options: [
      { pos: 'vt.', text: '放弃；抛弃；遗弃', ok: true },
      { pos: 'vt.', text: '丰富；充满；盛产' },
      { pos: 'vt.', text: '吸收；同化；吸引' },
      { pos: 'vt.', text: '废除；取消；废止' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '放弃，抛弃', ok: true },
      { pos: 'adj.', text: '丰富的，大量的' }, // abundant
      { pos: 'vt.', text: '废除，取消' }, // abolish
      { pos: 'vt.', text: '吸收，同化' }, // absorb
    ],
    sentences: [
      {
        src: '泰坦尼克号',
        theme: 'night',
        en: 'The captain was forced to order everyone to <b>abandon</b> ship.',
        zh: '船长被迫下令所有人弃船逃生。',
      },
      {
        src: '经济学人',
        theme: 'sky',
        en: 'The company decided to <b>abandon</b> the unprofitable project.',
        zh: '公司决定放弃这项毫无盈利希望的项目。',
      },
    ],
    total: 25,
    def: 'abandon /əˈbændən/ vt. to leave sb/sth that you are responsible for; to stop doing sth before finished 放弃，遗弃。',
    mnemo: {
      '词组搭配': [
        ['abandon hope', '放弃希望'],
        ['abandon oneself to', '沉湎于，沉溺于'],
        ['with abandon', '放纵地，尽情地'],
      ],
      '词根': [
        ['a- 不 + band 束缚', '摆脱一切规则和束缚 → 放任，放弃'],
        ['abandoned adj.', '被抛弃的；放荡的'],
        ['abandonment n.', '放弃，抛弃'],
      ],
      '近义': [
        ['desert v.', '舍弃，遗弃'],
        ['forsake v.', '摒弃，绝交'],
        ['relinquish v.', '让出，放弃'],
      ],
    },
  },

  // 8. abstract
  {
    id: 'w_abstract',
    w: 'abstract',
    syl: 'ab·stract',
    ph: '/ˈæbstrækt/',
    tags: ['CET-4', 'CET-6', '考研', '学术词汇'],
    senses: [
      { pos: 'adj.', items: ['抽象的', '纯理论的', '抽象派的'] },
      { pos: 'n.', items: ['摘要，概要', '抽象概念'] },
      { pos: 'vt.', items: ['提取，抽取', '写出摘要'] },
    ],
    options: [
      { pos: 'adj.', text: '抽象的；摘要', ok: true },
      { pos: 'adj.', text: '绝对的；完全的' },
      { pos: 'adj.', text: '荒谬的；可笑的' },
      { pos: 'adj.', text: '准确的；精确的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '抽象的；摘要', ok: true },
      { pos: 'vt.', text: '分散，使分心' }, // distract
      { pos: 'vt.', text: '吸引，引起' }, // attract
      { pos: 'vt.', text: '减去，扣除' }, // subtract
    ],
    sentences: [
      {
        src: '生活大爆炸 S04E12',
        theme: 'city',
        en: 'Theoretical physics often deals with highly <b>abstract</b> mathematical concepts.',
        zh: '理论物理学经常需要处理高度抽象的数学概念。',
      },
      {
        src: '学术论文前言',
        theme: 'sky',
        en: 'Please read the <b>abstract</b> before diving into the detailed methodology.',
        zh: '在深入研究具体方法之前，请先阅读论文摘要。',
      },
    ],
    total: 26,
    def: 'abstract /ˈæbstrækt/ adj. existing as an idea or feeling, not as a physical object 抽象的；n. 论文摘要。',
    mnemo: {
      '词组搭配': [
        ['in the abstract', '抽象地，理论上'],
        ['abstract art', '抽象艺术'],
        ['extended abstract', '详细摘要'],
      ],
      '词根': [
        ['abs- 离去 + tract- 拉，扯', '从具体形象中抽取出来 → 抽象，提炼'],
        ['attract v.', '吸引（at- 向 + tract 拉）'],
        ['distract v.', '分心（dis- 分开 + tract 拉）'],
      ],
      '近义': [
        ['theoretical adj.', '理论上的'],
        ['summary n.', '总结，概要'],
        ['extract n./v.', '提取物，提炼'],
      ],
    },
  },

  // 9. abundant
  {
    id: 'w_abundant',
    w: 'abundant',
    syl: 'a·bun·dant',
    ph: '/əˈbʌndənt/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'adj.', items: ['丰富的，充裕的', '盛产的，大量的'] },
    ],
    options: [
      { pos: 'adj.', text: '丰富的，充裕的', ok: true },
      { pos: 'adj.', text: '荒谬的，可笑的' },
      { pos: 'adj.', text: '明显的，显然的' },
      { pos: 'adj.', text: '足够的，合格的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '丰富的，充裕的', ok: true },
      { pos: 'adj.', text: '多余的，累赘的' }, // redundant
      { pos: 'adj.', text: '荒谬的，可笑的' }, // absurd
      { pos: 'adj.', text: '不情愿的，勉强的' }, // reluctant
    ],
    sentences: [
      {
        src: '国家地理',
        theme: 'forest',
        en: 'The tropical rainforest is blessed with <b>abundant</b> rainfall throughout the year.',
        zh: '热带雨林全年享有十分充沛的雨量。',
      },
      {
        src: '自然科学周刊',
        theme: 'sky',
        en: 'Scientists found <b>abundant</b> evidence of ancient microbial life on the meteorite.',
        zh: '科学家在陨石上发现了大量远古微生物生命的证据。',
      },
    ],
    total: 21,
    def: 'abundant /əˈbʌndənt/ adj. existing or available in large quantities; plentiful 丰富的，充裕的。',
    mnemo: {
      '词组搭配': [
        ['abundant in', '富于…，富产…'],
        ['abundant wildlife', '丰富的野生动植物'],
        ['in abundant supply', '供应充裕'],
      ],
      '词根': [
        ['ab- 加强 + und- 波浪，涌出', '像潮水波浪一样涌出 → 丰富充沛的'],
        ['abundance n.', '充裕，丰富'],
        ['redundant adj.', '波浪过满溢出 → 多余的，累赘的'],
      ],
      '近义': [
        ['plentiful adj.', '丰富的，充足的'],
        ['ample adj.', '足够的，宽敞的'],
        ['copious adj.', '大量的，充裕的'],
      ],
    },
  },

  // 10. access
  {
    id: 'w_access',
    w: 'access',
    syl: 'ac·cess',
    ph: '/ˈækses/',
    tags: ['CET-4', '高频', '计算机英语'],
    senses: [
      { pos: 'n.', items: ['通道，入口', '使用权，接触机会', '接近 (或进入) 的方法'] },
      { pos: 'vt.', items: ['访问，进入', '存取 (计算机数据)', '到达'] },
    ],
    options: [
      { pos: 'n./v.', text: '通道；访问；获取', ok: true },
      { pos: 'n./v.', text: '超出；过多；过量' },
      { pos: 'n./v.', text: '赞扬；称赞；表彰' },
      { pos: 'n./v.', text: '评估；估价；评定' },
    ],
    audioOptions: [
      { pos: 'n.', text: '通道；访问权', ok: true },
      { pos: 'n.', text: '过量，过度' }, // excess
      { pos: 'n.', text: '评估，估价' }, // assess
      { pos: 'n.', text: '接受，收受' }, // accept
    ],
    sentences: [
      {
        src: '硅谷 S02E03',
        theme: 'night',
        en: 'Only authorized personnel have <b>access</b> to the primary database server.',
        zh: '只有获得授权的人员才能访问主数据库服务器。',
      },
      {
        src: '联合国报告',
        theme: 'sky',
        en: 'Every child deserves equal <b>access</b> to high-quality education.',
        zh: '每个孩子都应该享有平等获得优质教育的机会。',
      },
    ],
    total: 38,
    def: 'access /ˈækses/ n. the opportunity or right to use sth; a way of entering or reaching 通道，进入权；v. 存取数据。',
    mnemo: {
      '词组搭配': [
        ['have access to', '可以利用…，有权进入…'],
        ['gain access to', '获得对…的访问权限'],
        ['access code', '通行码，密码'],
      ],
      '词根': [
        ['ac- 去向 + cess- 行走，去', '走向前去 → 接近，进入'],
        ['accessible adj.', '易接近的，可达到的'],
        ['accessibility n.', '无障碍性，易用性'],
      ],
      '近义': [
        ['entry n.', '进入，入口'],
        ['approach n./v.', '接近，途径'],
        ['admission n.', '准许进入'],
      ],
    },
  },

  // 11. accommodate
  {
    id: 'w_accommodate',
    w: 'accommodate',
    syl: 'ac·com·mo·date',
    ph: '/əˈkɑːmədeɪt/',
    tags: ['CET-6', '考研', '雅思'],
    senses: [
      { pos: 'v.', items: ['容纳，提供住宿', '使适应，顺应', '迎合，迁就', '调解'] },
    ],
    options: [
      { pos: 'v.', text: '容纳；提供住宿；适应', ok: true },
      { pos: 'v.', text: '陪伴；伴随；伴奏' },
      { pos: 'v.', text: '累积；积聚；堆积' },
      { pos: 'v.', text: '称赞；表扬；推荐' },
    ],
    audioOptions: [
      { pos: 'v.', text: '容纳；提供住宿', ok: true },
      { pos: 'v.', text: '陪伴，伴随' }, // accompany
      { pos: 'v.', text: '积累，积聚' }, // accumulate
      { pos: 'v.', text: '赞扬，表扬' }, // acclaim
    ],
    sentences: [
      {
        src: '卫报',
        theme: 'city',
        en: 'The newly built Olympic stadium can easily <b>accommodate</b> over 80,000 spectators.',
        zh: '新建的奥林匹克体育场可轻松容纳超过 8 万名观众。',
      },
      {
        src: '哈佛商业评论',
        theme: 'sky',
        en: 'Great managers learn to <b>accommodate</b> different working styles in diverse teams.',
        zh: '优秀的管理者懂得在多元团队中包容和顺应不同的工作风格。',
      },
    ],
    total: 27,
    def: 'accommodate /əˈkɑːmədeɪt/ v. to provide sb with a room or place to stay; to consider and satisfy needs 容纳；顺应。',
    mnemo: {
      '词组搭配': [
        ['accommodate needs', '满足需求'],
        ['accommodate changes', '适应变化'],
        ['accommodate guests', '招待客人'],
      ],
      '词根': [
        ['ac- 朝向 + com- 共同 + mod- 尺度，合适', '使大家共同处于合适空间 → 容纳，顺应'],
        ['accommodation n.', '住宿，膳宿；和解'],
        ['accommodating adj.', '乐于助人的，随和的'],
      ],
      '近义': [
        ['lodge v.', '寄宿，安顿'],
        ['contain v.', '包含，容纳'],
        ['adapt v.', '适应，顺应'],
      ],
    },
  },

  // 12. accumulate
  {
    id: 'w_accumulate',
    w: 'accumulate',
    syl: 'ac·cu·mu·late',
    ph: '/əˈkjuːmjəleɪt/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'v.', items: ['积累，积聚', '逐渐增加', '堆积'] },
    ],
    options: [
      { pos: 'v.', text: '积累，积聚；增加', ok: true },
      { pos: 'v.', text: '加速；促进；提前' },
      { pos: 'v.', text: '宣称；声称；断言' },
      { pos: 'v.', text: '同化；吸收；消化' },
    ],
    audioOptions: [
      { pos: 'v.', text: '积累，积聚', ok: true },
      { pos: 'v.', text: '计算，核算' }, // calculate
      { pos: 'v.', text: '加速，提速' }, // accelerate
      { pos: 'v.', text: '容纳，提供住宿' }, // accommodate
    ],
    sentences: [
      {
        src: '华尔街日报',
        theme: 'city',
        en: 'Through disciplined saving, he was able to <b>accumulate</b> substantial wealth.',
        zh: '通过自律的储蓄，他得以积累了可观的财富。',
      },
      {
        src: '科学美国人',
        theme: 'forest',
        en: 'Harmful microplastics continue to <b>accumulate</b> in marine ecosystems.',
        zh: '有害的微塑料在海洋生态系统中不断堆积。',
      },
    ],
    total: 24,
    def: 'accumulate /əˈkjuːmjəleɪt/ v. to gradually get more and more of sth over a period of time 积累，积聚。',
    mnemo: {
      '词组搭配': [
        ['accumulate wealth', '积累财富'],
        ['accumulate evidence', '收集证据'],
        ['accumulate dust', '落满灰尘'],
      ],
      '词根': [
        ['ac- 加强 + cumul- 堆堆，堆积', '不断往上堆积 → 积累'],
        ['cumulate v.', '堆积，成堆'],
        ['cumulative adj.', '累积的，渐增的'],
      ],
      '近义': [
        ['amass v.', '积聚，大量收集'],
        ['gather v.', '聚集，采集'],
        ['pile up v.', '堆起，积压'],
      ],
    },
  },

  // 13. accurate
  {
    id: 'w_accurate',
    w: 'accurate',
    syl: 'ac·cu·rate',
    ph: '/ˈækjərət/',
    tags: ['CET-4', '高频'],
    senses: [
      { pos: 'adj.', items: ['精确的，准确的', '正确的，无差错的'] },
    ],
    options: [
      { pos: 'adj.', text: '精确的，准确的', ok: true },
      { pos: 'adj.', text: '急性的；敏锐的' },
      { pos: 'adj.', text: '适当的；恰当的' },
      { pos: 'adj.', text: '显然的；表面上的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '精确的，准确的', ok: true },
      { pos: 'adj.', text: '合格的，充裕的' }, // adequate
      { pos: 'adj.', text: '敏锐的，急性的' }, // acute
      { pos: 'adj.', text: '精致的，精巧的' }, // delicate
    ],
    sentences: [
      {
        src: '福尔摩斯探案',
        theme: 'night',
        en: 'His deductions were always remarkably <b>accurate</b> and insightful.',
        zh: '他的推理判断总是异常精确且富有洞察力。',
      },
      {
        src: '气象早报',
        theme: 'sky',
        en: 'Modern satellites provide extremely <b>accurate</b> storm tracking data.',
        zh: '现代气象卫星提供了极为精准的风暴追踪数据。',
      },
    ],
    total: 30,
    def: 'accurate /ˈækjərət/ adj. correct and true in every detail; exact 准确的，精确的。',
    mnemo: {
      '词组搭配': [
        ['accurate description', '精准的描述'],
        ['accurate forecast', '准确的预报'],
        ['accurate measurement', '精确的测量'],
      ],
      '词根': [
        ['ac- 去 + cur- 关照，小心', '经过精心照料与校对 → 准确无误的'],
        ['accuracy n.', '精确度，准确性'],
        ['inaccurate adj.', '不准确的，有偏差的'],
      ],
      '近义': [
        ['precise adj.', '精准的，明确的'],
        ['exact adj.', '丝毫不差的'],
        ['correct adj.', '正确的'],
      ],
    },
  },

  // 14. acquire
  {
    id: 'w_acquire',
    w: 'acquire',
    syl: 'ac·quire',
    ph: '/əˈkwaɪər/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'vt.', items: ['获得，学到 (知识/技能)', '收购 (公司)', '养成 (习惯)'] },
    ],
    options: [
      { pos: 'vt.', text: '获得；学到；收购', ok: true },
      { pos: 'vt.', text: '要求；需要；命令' },
      { pos: 'vt.', text: '询问；调查；查问' },
      { pos: 'vt.', text: '启发；引起；激发' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '获得；学到', ok: true },
      { pos: 'vt.', text: '需要，要求' }, // require
      { pos: 'vt.', text: '询问，打听' }, // inquire
      { pos: 'vt.', text: '激励，鼓舞' }, // inspire
    ],
    sentences: [
      {
        src: '摩登家庭 S03E14',
        theme: 'sky',
        en: 'Children <b>acquire</b> language naturally by listening to their parents.',
        zh: '孩子们通过倾听父母的说话自然而然地习得语言。',
      },
      {
        src: '科技快讯',
        theme: 'city',
        en: 'The tech giant announced its plan to <b>acquire</b> the startup for $2 billion.',
        zh: '这家科技巨头宣布了以 20 亿美元收购该初创企业的计划。',
      },
    ],
    total: 31,
    def: 'acquire /əˈkwaɪər/ vt. to gain sth by your own efforts, ability or behavior; to buy a company 获得；学到；收购。',
    mnemo: {
      '词组搭配': [
        ['acquire knowledge', '获取知识'],
        ['acquire a habit', '养成习惯'],
        ['acquire a company', '收购公司'],
      ],
      '词根': [
        ['ac- 去 + quire- 寻找，求索', '去寻找并拿到手 → 获得，取得'],
        ['acquisition n.', '获得物；收购，并购'],
        ['acquisitive adj.', '贪得无厌的，渴望得到的'],
      ],
      '近义': [
        ['obtain v.', '获取，赢得'],
        ['gain v.', '增加，获取'],
        ['purchase v.', '购买，收购'],
      ],
    },
  },

  // 15. adapt
  {
    id: 'w_adapt',
    w: 'adapt',
    syl: 'a·dapt',
    ph: '/əˈdæpt/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'v.', items: ['适应 (新环境/情况)', '改编，改写 (剧本/书籍)', '改造'] },
    ],
    options: [
      { pos: 'v.', text: '适应；改编；改造', ok: true },
      { pos: 'v.', text: '采纳；收养；领养' },
      { pos: 'adj.', text: '熟练的；内行的' },
      { pos: 'v.', text: '吸附；粘合；坚持' },
    ],
    audioOptions: [
      { pos: 'v.', text: '适应；改编', ok: true },
      { pos: 'v.', text: '采纳，收养' }, // adopt
      { pos: 'adj.', text: '熟练的，精通的' }, // adept
      { pos: 'v.', text: '崇拜，热爱' }, // adore
    ],
    sentences: [
      {
        src: '蓝色星球 II',
        theme: 'forest',
        en: 'Desert creatures must <b>adapt</b> to extreme temperatures to survive.',
        zh: '沙漠生物必须适应极端的气温才能存活。',
      },
      {
        src: '好莱坞报道',
        theme: 'night',
        en: 'The director plans to <b>adapt</b> the best-selling novel into a movie.',
        zh: '导演计划将这本畅销小说改编成电影。',
      },
    ],
    total: 28,
    def: 'adapt /əˈdæpt/ v. to change your behaviour in order to deal more successfully with a new situation 适应；改编。',
    mnemo: {
      '词组搭配': [
        ['adapt to', '适应…'],
        ['adapt for', '改编为…'],
        ['adapt oneself to', '使自己顺应…'],
      ],
      '词根': [
        ['ad- 去向 + apt- 适合，合适', '使自己变得适合 → 适应，改编'],
        ['adaptation n.', '适应；改编本'],
        ['adaptable adj.', '有适应能力的，能顺应的'],
      ],
      '近义': [
        ['adjust v.', '调整，适应'],
        ['acclimate v.', '服水土，适应气候'],
        ['modify v.', '修改，调正'],
      ],
    },
  },

  // 16. adequate
  {
    id: 'w_adequate',
    w: 'adequate',
    syl: 'ad·e·quate',
    ph: '/ˈædɪkwət/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'adj.', items: ['充分的，足够的', '合格的，合乎需要的', '尚可的'] },
    ],
    options: [
      { pos: 'adj.', text: '足够的，充分的；合格的', ok: true },
      { pos: 'adj.', text: '精致的；敏锐的' },
      { pos: 'adj.', text: '明显的；表面上的' },
      { pos: 'adj.', text: '雄心勃勃的；好胜的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '足够的，充分的', ok: true },
      { pos: 'adj.', text: '精确的，准确的' }, // accurate
      { pos: 'adj.', text: '敏锐的，急性的' }, // acute
      { pos: 'adj.', text: '相等的，均等的' }, // equate
    ],
    sentences: [
      {
        src: '世界卫生组织倡议',
        theme: 'sky',
        en: 'Getting <b>adequate</b> sleep is vital for maintaining physical and mental health.',
        zh: '获得充足的睡眠对维持身心健康至关重要。',
      },
      {
        src: '工程安全报告',
        theme: 'city',
        en: 'The current ventilation system is barely <b>adequate</b> for this huge hall.',
        zh: '现有的通风系统对于如此巨大的大厅来说仅仅勉强够用。',
      },
    ],
    total: 23,
    def: 'adequate /ˈædɪkwət/ adj. enough in quantity, or good enough in quality for a particular purpose 足够的，合乎需要的。',
    mnemo: {
      '词组搭配': [
        ['adequate funding', '充足的资金支持'],
        ['adequate for the job', '胜任该工作'],
        ['barely adequate', '勉强够用'],
      ],
      '词根': [
        ['ad- 去 + equ- 相等，均等', '刚好达到标准相等线 → 足够的，合格的'],
        ['adequacy n.', '充足，适当'],
        ['inadequate adj.', '不足的，不充分的'],
      ],
      '近义': [
        ['sufficient adj.', '充分的，充足的'],
        ['enough adj.', '足够'],
        ['satisfactory adj.', '令人满意的，合格的'],
      ],
    },
  },

  // 17. advocate
  {
    id: 'w_advocate',
    w: 'advocate',
    syl: 'ad·vo·cate',
    ph: '/ˈædvəkeɪt/',
    tags: ['CET-6', '考研', '雅思/托福'],
    senses: [
      { pos: 'vt.', items: ['拥护，提倡，主张'] },
      { pos: 'n.', items: ['拥护者，倡导者', '辩护律师'] },
    ],
    options: [
      { pos: 'v./n.', text: '提倡，拥护；倡导者', ok: true },
      { pos: 'v./n.', text: '分配，分派；划拨' },
      { pos: 'v./n.', text: '呼吁；上诉；吸引力' },
      { pos: 'v./n.', text: '任命；指定；约会' },
    ],
    audioOptions: [
      { pos: 'v.', text: '提倡，拥护', ok: true },
      { pos: 'v.', text: '疏散，撤退' }, // evacuate
      { pos: 'v.', text: '分配，分派' }, // allocate
      { pos: 'v.', text: '唤起，引起' }, // evoke
    ],
    sentences: [
      {
        src: '联合国气候峰会',
        theme: 'forest',
        en: 'Scientists continue to <b>advocate</b> for a drastic reduction in carbon emissions.',
        zh: '科学家们持续呼吁并主张大幅减少碳排放。',
      },
      {
        src: '传记名言',
        theme: 'night',
        en: 'She was a lifelong <b>advocate</b> of civil rights and human equality.',
        zh: '她是民权与人类平等事业终生不渝的倡导者。',
      },
    ],
    total: 29,
    def: 'advocate /ˈædvəkeɪt/ v. to publicly support or suggest an idea; n. a person who supports or speaks in favour 提倡；倡导者。',
    mnemo: {
      '词组搭配': [
        ['advocate for', '呼吁支持…'],
        ['fierce advocate', '坚定的拥护者'],
        ['consumer advocate', '消费者权益保护者'],
      ],
      '词根': [
        ['ad- 向前 + voc- 声音，呼喊', '向前发出大声支持呼吁 → 倡导，拥护'],
        ['advocacy n.', '主张，拥护，倡导'],
        ['vocal adj.', '直言不讳的；声音的'],
      ],
      '近义': [
        ['champion v./n.', '捍卫，倡导'],
        ['promote v.', '促进，宣扬'],
        ['supporter n.', '支持者'],
      ],
    },
  },

  // 18. affection
  {
    id: 'w_affection',
    w: 'affection',
    syl: 'af·fec·tion',
    ph: '/əˈfekʃn/',
    tags: ['CET-4', 'CET-6'],
    senses: [
      { pos: 'n.', items: ['喜爱，感情，爱慕', '钟爱，关爱'] },
    ],
    options: [
      { pos: 'n.', text: '喜爱，关爱；感情', ok: true },
      { pos: 'n.', text: '影响；结果；效果' },
      { pos: 'n.', text: '痛苦；苦难；折磨' },
      { pos: 'n.', text: '感染；传染病；败血' },
    ],
    audioOptions: [
      { pos: 'n.', text: '喜爱，关爱', ok: true },
      { pos: 'n.', text: '折磨，痛苦' }, // affliction
      { pos: 'n.', text: '感染，传染' }, // infection
      { pos: 'n.', text: '影响，效果' }, // effect
    ],
    sentences: [
      {
        src: '傲慢与偏见',
        theme: 'sky',
        en: 'He looked at her with genuine warmth and deep <b>affection</b>.',
        zh: '他带着由衷的温情与深深的爱意注视着她。',
      },
    ],
    total: 19,
    def: 'affection /əˈfekʃn/ n. a feeling of liking and caring about someone or something 喜爱，关爱，钟情。',
    mnemo: {
      '词组搭配': [
        ['have affection for', '喜爱…，对…怀有深情'],
        ['win sb\'s affection', '赢得某人的欢心'],
        ['mutual affection', '互相倾慕'],
      ],
      '词根': [
        ['af- 去向 + fect- 做，打动', '内心被某人所触动 → 喜爱，关爱'],
        ['affectionate adj.', '充满深情的，温柔的'],
      ],
      '近义': [
        ['fondness n.', '喜爱，温情'],
        ['attachment n.', '依恋，爱慕'],
        ['love n.', '爱'],
      ],
    },
  },

  // 19. aggressive
  {
    id: 'w_aggressive',
    w: 'aggressive',
    syl: 'ag·gres·sive',
    ph: '/əˈɡresɪv/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'adj.', items: ['好斗的，侵略性的', '有进取心的，敢作敢为的', '剧烈的，强有力的 (疗法)'] },
    ],
    options: [
      { pos: 'adj.', text: '好斗的；有进取心的', ok: true },
      { pos: 'adj.', text: '雄心勃勃的；野心的' },
      { pos: 'adj.', text: '警觉的；警惕的' },
      { pos: 'adj.', text: '吸引人的；呼吁的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '好斗的；进取的', ok: true },
      { pos: 'adj.', text: '令人印象深刻的' }, // impressive
      { pos: 'adj.', text: '压抑的，沉闷的' }, // oppressive
      { pos: 'adj.', text: '退步的，累退的' }, // regressive
    ],
    sentences: [
      {
        src: '华尔街之狼',
        theme: 'city',
        en: 'The startup launched an <b>aggressive</b> marketing campaign across all platforms.',
        zh: '这家初创公司在所有平台上发起了一场极具进取性的营销攻势。',
      },
      {
        src: '动物星球',
        theme: 'forest',
        en: 'The mother bear becomes fiercely <b>aggressive</b> when protecting her cubs.',
        zh: '母熊在保护幼崽时会变得极具攻击性。',
      },
    ],
    total: 27,
    def: 'aggressive /əˈɡresɪv/ adj. behaving in an angry and violent way; determined to win or succeed 好斗的；有进取心的。',
    mnemo: {
      '词组搭配': [
        ['aggressive behavior', '攻击性行为'],
        ['aggressive expansion', '激进扩张'],
        ['aggressive marketing', '强力营销'],
      ],
      '词根': [
        ['ag- 向前 + gress- 走，跨步', '大步流星向前冲 → 进攻性的，进取的'],
        ['aggression n.', '侵略，攻击性'],
        ['aggressor n.', '侵略者，挑衅者'],
      ],
      '近义': [
        ['belligerent adj.', '好战的，挑衅的'],
        ['assertive adj.', '坚定自信的，有干劲的'],
        ['combative adj.', '好斗的'],
      ],
    },
  },

  // 20. alert
  {
    id: 'w_alert',
    w: 'alert',
    syl: 'a·lert',
    ph: '/əˈlɜːrt/',
    tags: ['CET-4', '高频'],
    senses: [
      { pos: 'adj.', items: ['警觉的，警惕的', '机敏的，头脑敏捷的'] },
      { pos: 'n.', items: ['警报，警戒状态'] },
      { pos: 'vt.', items: ['使警惕，向…发出警报'] },
    ],
    options: [
      { pos: 'adj./n.', text: '警惕的；警报', ok: true },
      { pos: 'adj./n.', text: '修改；改变；调正' },
      { pos: 'adj./n.', text: '结盟；联盟；同盟' },
      { pos: 'adj./n.', text: '赞成；批准；认可' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '警惕的；警报', ok: true },
      { pos: 'v.', text: '改变，修改' }, // alter
      { pos: 'adj.', text: '敏捷的，灵活的' }, // agile
      { pos: 'adj.', text: '熟练的，精通的' }, // adept
    ],
    sentences: [
      {
        src: '谍影重重',
        theme: 'night',
        en: 'The security guards remained on high <b>alert</b> throughout the president\'s visit.',
        zh: '在总统访问期间，安保人员始终保持高度戒备。',
      },
      {
        src: '医学早参',
        theme: 'sky',
        en: 'Coffee can help you feel more <b>alert</b> and focused in the early morning.',
        zh: '早晨喝咖啡能让你感觉更加警觉和专注。',
      },
    ],
    total: 25,
    def: 'alert /əˈlɜːrt/ adj. quick to see, understand, and act in a particular situation 警惕的；n. 警报。',
    mnemo: {
      '词组搭配': [
        ['on alert', '处于警戒状态'],
        ['red alert', '红色警报'],
        ['stay alert', '保持警惕'],
        ['alert sb to sth', '提醒某人注意…'],
      ],
      '词根': [
        ['源自意大利语 all\'erta（在瞭望塔上站岗）', '登高瞭望 → 警觉警报'],
      ],
      '近义': [
        ['vigilant adj.', '警醒的，警惕的'],
        ['watchful adj.', '注意的，警觉的'],
        ['warning n.', '警报，告诫'],
      ],
    },
  },

  // 21. allocate
  {
    id: 'w_allocate',
    w: 'allocate',
    syl: 'al·lo·cate',
    ph: '/ˈæləkeɪt/',
    tags: ['CET-6', '考研', '商务英语'],
    senses: [
      { pos: 'vt.', items: ['分配，分派', '划拨 (资金/资源)'] },
    ],
    options: [
      { pos: 'vt.', text: '分配，划拨(资源)', ok: true },
      { pos: 'vt.', text: '提倡，拥护；倡导' },
      { pos: 'vt.', text: '积累，积聚；堆积' },
      { pos: 'vt.', text: '允许，准许；认可' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '分配，划拨', ok: true },
      { pos: 'vt.', text: '定位，找到' }, // locate
      { pos: 'vt.', text: '提倡，拥护' }, // advocate
      { pos: 'vt.', text: '疏散，撤退' }, // evacuate
    ],
    sentences: [
      {
        src: '彭博商业周刊',
        theme: 'city',
        en: 'The board voted to <b>allocate</b> more funds to artificial intelligence research.',
        zh: '董事会投票决定向人工智能研发分配更多资金。',
      },
    ],
    total: 22,
    def: 'allocate /ˈæləkeɪt/ vt. to give sth officially to sb/sth for a particular purpose 分配，划拨。',
    mnemo: {
      '词组搭配': [
        ['allocate resources', '分配资源'],
        ['allocate budget', '划拨预算'],
        ['allocate time', '分配时间'],
      ],
      '词根': [
        ['al- 去 + loc- 地方，位置', '把物资安排放到各自的地方 → 分配，分拨'],
        ['allocation n.', '分配，拨款'],
      ],
      '近义': [
        ['assign v.', '指定，分派'],
        ['distribute v.', '分发，散布'],
        ['apportion v.', '按比例分配'],
      ],
    },
  },

  // 22. ambitious
  {
    id: 'w_ambitious',
    w: 'ambitious',
    syl: 'am·bi·tious',
    ph: '/æmˈbɪʃəs/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'adj.', items: ['有雄心的，野心勃勃的', '宏大的，艰巨的 (计划)'] },
    ],
    options: [
      { pos: 'adj.', text: '有雄心的；宏大的', ok: true },
      { pos: 'adj.', text: '模棱两可的；含糊的' },
      { pos: 'adj.', text: '好斗的；侵略性的' },
      { pos: 'adj.', text: '人工的；人造的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '有雄心的，宏大的', ok: true },
      { pos: 'adj.', text: '模棱两可的' }, // ambiguous
      { pos: 'adj.', text: '恶意的，恶毒的' }, // malicious
      { pos: 'adj.', text: '吉利的，幸运的' }, // auspicious
    ],
    sentences: [
      {
        src: '硅谷传奇',
        theme: 'night',
        en: 'He was an extraordinarily <b>ambitious</b> entrepreneur with big dreams.',
        zh: '他是一位怀揣宏大梦想且极富雄心的创业家。',
      },
    ],
    total: 24,
    def: 'ambitious /æmˈbɪʃəs/ adj. having a strong desire for success or achievement 雄心勃勃的；宏大的。',
    mnemo: {
      '词组搭配': [
        ['ambitious project', '宏大艰巨的项目'],
        ['ambitious goal', '雄心勃勃的目标'],
      ],
      '词根': [
        ['ambi- 到处 + it- 走', '为了拉选票到处走动游说 → 有野心雄心的'],
        ['ambition n.', '雄心，抱负'],
      ],
      '近义': [
        ['aspiring adj.', '有抱负的'],
        ['enterprising adj.', '有事业心的'],
      ],
    },
  },

  // 23. analyze
  {
    id: 'w_analyze',
    w: 'analyze',
    syl: 'an·a·lyze',
    ph: '/ˈænəlaɪz/',
    tags: ['CET-4', '高频', '学术词汇'],
    senses: [
      { pos: 'vt.', items: ['分析，剖析', '分解 (物质/成分)'] },
    ],
    options: [
      { pos: 'vt.', text: '分析，剖析；分解', ok: true },
      { pos: 'vt.', text: '宣告；声明；声称' },
      { pos: 'vt.', text: '期望；预期；预先处理' },
      { pos: 'vt.', text: '道歉；认错；辩解' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '分析，剖析', ok: true },
      { pos: 'vt.', text: '使瘫痪，使麻痹' }, // paralyze
      { pos: 'vt.', text: '催化，促成' }, // catalyze
      { pos: 'vt.', text: '同化，吸收' }, // assimilate
    ],
    sentences: [
      {
        src: 'CSI 犯罪现场调查',
        theme: 'night',
        en: 'Forensic scientists are working round the clock to <b>analyze</b> the DNA sample.',
        zh: '法医科学家正在夜以继日地分析这组 DNA 样本。',
      },
    ],
    total: 33,
    def: 'analyze /ˈænəlaɪz/ vt. to examine the details of sth carefully, in order to understand or explain it 分析，剖析。',
    mnemo: {
      '词组搭配': [
        ['analyze data', '分析数据'],
        ['analyze the cause', '剖析原因'],
      ],
      '词根': [
        ['ana- 向上，彻底 + lyze- 解开，松开', '彻底拆解开来细细审视 → 分析'],
        ['analysis n.', '分析，化验'],
        ['analyst n.', '分析家，化验员'],
      ],
      '近义': [
        ['examine v.', '检查，审视'],
        ['dissect v.', '解剖，仔细研究'],
        ['evaluate v.', '评估，评价'],
      ],
    },
  },

  // 24. anticipate
  {
    id: 'w_anticipate',
    w: 'anticipate',
    syl: 'an·ti·ci·pate',
    ph: '/ænˈtɪsɪpeɪt/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'vt.', items: ['预期，期望', '预料 (并提前做准备)', '先于…做'] },
    ],
    options: [
      { pos: 'vt.', text: '预期，预料；期望', ok: true },
      { pos: 'vt.', text: '参与；参加；分享' },
      { pos: 'vt.', text: '感激；欣赏；升值' },
      { pos: 'vt.', text: '指定；任命；约会' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '预料，预期', ok: true },
      { pos: 'v.', text: '参与，参加' }, // participate
      { pos: 'vt.', text: '使沉淀，促成' }, // precipitate
      { pos: 'vt.', text: '使心神不宁' }, // agitate
    ],
    sentences: [
      {
        src: '金融时报',
        theme: 'city',
        en: 'Economists <b>anticipate</b> a steady rise in interest rates next quarter.',
        zh: '经济学家预料下个季度利率将稳步上升。',
      },
    ],
    total: 26,
    def: 'anticipate /ænˈtɪsɪpeɪt/ vt. to expect sth to happen and be ready for it 预料，预期。',
    mnemo: {
      '词组搭配': [
        ['anticipate problems', '预先考虑问题'],
        ['eagerly anticipate', '热切期待'],
      ],
      '词根': [
        ['anti- 在前 + cip- 拿取', '提前拿到手中考虑 → 预先料到'],
        ['anticipation n.', '预见，期待'],
      ],
      '近义': [
        ['expect v.', '期待，料想'],
        ['foresee v.', '预见'],
        ['predict v.', '预言'],
      ],
    },
  },

  // 25. apparent
  {
    id: 'w_apparent',
    w: 'apparent',
    syl: 'ap·par·ent',
    ph: '/əˈpærənt/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'adj.', items: ['显而易见的，明白的', '表面上的，貌似的'] },
    ],
    options: [
      { pos: 'adj.', text: '显然的；表面上的', ok: true },
      { pos: 'adj.', text: '呼吁的；吸引人的' },
      { pos: 'adj.', text: '透明的；清澈的' },
      { pos: 'adj.', text: '适当的；恰当的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '显然的，明显的', ok: true },
      { pos: 'adj.', text: '透明的，清澈的' }, // transparent
      { pos: 'adj.', text: '傲慢的，自大的' }, // arrogant
      { pos: 'adj.', text: '亲代的，父母的' }, // parental
    ],
    sentences: [
      {
        src: '无人生还',
        theme: 'night',
        en: 'It soon became <b>apparent</b> that no one would be rescued from the island.',
        zh: '很快真相大白：没有人会从这座孤岛上获救。',
      },
    ],
    total: 25,
    def: 'apparent /əˈpærənt/ adj. clear and easy to see or understand; seeming to be true 显而易见的；表面上的。',
    mnemo: {
      '词组搭配': [
        ['it is apparent that', '显而易见的是…'],
        ['for no apparent reason', '不知何故，毫无缘由'],
      ],
      '词根': [
        ['ap- 去 + par- 出现', '清晰出现在眼前 → 显而易见的'],
        ['apparently adv.', '显而易见地；表面上看来'],
      ],
      '近义': [
        ['obvious adj.', '明显的'],
        ['evident adj.', '明了的，有证据的'],
        ['manifest adj.', '显露的'],
      ],
    },
  },

  // 26. appeal
  {
    id: 'w_appeal',
    w: 'appeal',
    syl: 'ap·peal',
    ph: '/əˈpiːl/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'v.', items: ['呼吁，恳求', '有吸引力，引起兴趣', '上诉'] },
      { pos: 'n.', items: ['吸引力，感染力', '呼吁', '上诉'] },
    ],
    options: [
      { pos: 'v./n.', text: '呼吁；吸引力；上诉', ok: true },
      { pos: 'v./n.', text: '出现；显露；露面' },
      { pos: 'v./n.', text: '鼓掌；喝彩；赞许' },
      { pos: 'v./n.', text: '任命；指派；约会' },
    ],
    audioOptions: [
      { pos: 'v.', text: '呼吁；吸引力', ok: true },
      { pos: 'v.', text: '出现，显现' }, // appear
      { pos: 'v.', text: '鼓掌，喝彩' }, // applaud
      { pos: 'v.', text: '平息，安抚' }, // appease
    ],
    sentences: [
      {
        src: '广告狂人 S01E01',
        theme: 'city',
        en: 'The classic vintage design continues to <b>appeal</b> to modern young consumers.',
        zh: '这种经典的复古设计持续吸引着当代的年轻消费者。',
      },
    ],
    total: 30,
    def: 'appeal /əˈpiːl/ v. to make a serious request; to be attractive or interesting; n. 吸引力；呼吁。',
    mnemo: {
      '词组搭配': [
        ['appeal to sb', '吸引某人；向某人呼吁'],
        ['make an appeal', '发出呼吁'],
        ['court of appeal', '上诉法院'],
      ],
      '词根': [
        ['ap- 去 + peal- 驱使，呼唤', '驱使人们前来注意 → 呼吁，吸引'],
        ['appealing adj.', '有吸引力的，动人的'],
      ],
      '近义': [
        ['attract v.', '吸引'],
        ['plead v.', '恳求，辩护'],
        ['charm n./v.', '魅力，吸引'],
      ],
    },
  },

  // 27. appoint
  {
    id: 'w_appoint',
    w: 'appoint',
    syl: 'ap·point',
    ph: '/əˈpɔɪnt/',
    tags: ['CET-4', '高频'],
    senses: [
      { pos: 'vt.', items: ['任命，委任', '确定，指定 (时间/地点)'] },
    ],
    options: [
      { pos: 'vt.', text: '任命，委任；指定', ok: true },
      { pos: 'vt.', text: '失望；使扫兴；挫败' },
      { pos: 'vt.', text: '接近；探讨；着手' },
      { pos: 'vt.', text: '赞成；批准；同意' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '任命；指定', ok: true },
      { pos: 'vt.', text: '使失望，使沮丧' }, // disappoint
      { pos: 'vt.', text: '给…抹油，指定' }, // anoint
      { pos: 'v.', text: '联合，接合' }, // adjoin
    ],
    sentences: [
      {
        src: '唐宁街十号',
        theme: 'city',
        en: 'The prime minister decided to <b>appoint</b> a new finance minister today.',
        zh: '首相决定在今天任命一位新的财政大臣。',
      },
    ],
    total: 27,
    def: 'appoint /əˈpɔɪnt/ vt. to choose sb for a job or position of responsibility 任命；指定。',
    mnemo: {
      '词组搭配': [
        ['appoint sb as', '任命某人为…'],
        ['at the appointed time', '在约定的时间'],
      ],
      '词根': [
        ['ap- 去 + point 点', '用手指点指定某人 → 任命，指定'],
        ['appointment n.', '约会，预约；任命'],
      ],
      '近义': [
        ['designate v.', '指定，指派'],
        ['nominate v.', '提名，任命'],
        ['assign v.', '指派'],
      ],
    },
  },

  // 28. appreciate
  {
    id: 'w_appreciate',
    w: 'appreciate',
    syl: 'ap·pre·ci·ate',
    ph: '/əˈpriːʃieɪt/',
    tags: ['CET-4', 'CET-6', '高频'],
    senses: [
      { pos: 'v.', items: ['感激，感谢', '欣赏，赏识', '领会，意识到', '增值，升值'] },
    ],
    options: [
      { pos: 'v.', text: '感激；欣赏；升值', ok: true },
      { pos: 'v.', text: '评价；评估；估价' },
      { pos: 'v.', text: '接近；靠近；着手' },
      { pos: 'v.', text: '分配；划拨；分摊' },
    ],
    audioOptions: [
      { pos: 'v.', text: '感激；欣赏；升值', ok: true },
      { pos: 'v.', text: '折旧，贬值' }, // depreciate
      { pos: 'v.', text: '逮捕，理解' }, // apprehend
      { pos: 'v.', text: '挪用，盗用' }, // appropriate
    ],
    sentences: [
      {
        src: '老友记 S05E11',
        theme: 'sky',
        en: 'I really <b>appreciate</b> all the help and support you have given me.',
        zh: '我真的很感激你给予我的所有帮助与支持。',
      },
    ],
    total: 36,
    def: 'appreciate /əˈpriːʃieɪt/ v. to recognize the good qualities of sth; to be grateful for sth 感激；欣赏；升值。',
    mnemo: {
      '词组搭配': [
        ['highly appreciate', '高度赞赏，十分感激'],
        ['appreciate in value', '升值，增值'],
      ],
      '词根': [
        ['ap- 去 + preci- 价值，价格', '给出应得的价值认可 → 赏识，感激，升值'],
        ['appreciation n.', '感激；欣赏；涨价'],
        ['appreciative adj.', '感激的，赏识的'],
      ],
      '近义': [
        ['value v.', '重视，珍惜'],
        ['cherish v.', '珍爱'],
        ['be grateful', '心怀感激'],
      ],
    },
  },

  // 29. approach
  {
    id: 'w_approach',
    w: 'approach',
    syl: 'ap·proach',
    ph: '/əˈproʊtʃ/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'v.', items: ['接近，靠近', '着手处理，对付', '接洽'] },
      { pos: 'n.', items: ['方法，途径', '接近，靠近', '通道'] },
    ],
    options: [
      { pos: 'v./n.', text: '接近；方法，途径', ok: true },
      { pos: 'v./n.', text: '赞成；批准；同意' },
      { pos: 'v./n.', text: '任命；指定；委派' },
      { pos: 'v./n.', text: '责怪；批评；谴责' },
    ],
    audioOptions: [
      { pos: 'v.', text: '接近；方法', ok: true },
      { pos: 'v.', text: '责备，谴责' }, // reproach
      { pos: 'v.', text: '赞成，批准' }, // approve
      { pos: 'v.', text: '附上，系上' }, // attach
    ],
    sentences: [
      {
        src: '经济学人精选',
        theme: 'city',
        en: 'We need to adopt a fresh and innovative <b>approach</b> to solving climate change.',
        zh: '我们需要采取一种崭新且富有创新性的方法来解决气候变化问题。',
      },
    ],
    total: 34,
    def: 'approach /əˈproʊtʃ/ v. to come near to sb/sth; n. a way of dealing with sb/sth 接近；方法，途径。',
    mnemo: {
      '词组搭配': [
        ['new approach to', '处理…的新方法'],
        ['approach a problem', '着手解决问题'],
        ['winter is approaching', '冬天正在临近'],
      ],
      '词根': [
        ['ap- 去 + proach- 靠近 (源自 near)', '走近，靠近 → 接近，探讨方法'],
        ['approachable adj.', '平易近人的，容易接触的'],
      ],
      '近义': [
        ['method n.', '方法'],
        ['strategy n.', '策略'],
        ['near v.', '临近'],
      ],
    },
  },

  // 30. appropriate
  {
    id: 'w_appropriate',
    w: 'appropriate',
    syl: 'ap·pro·pri·ate',
    ph: '/əˈproʊpriət/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'adj.', items: ['恰当的，合适的，适宜的'] },
      { pos: 'vt.', items: ['挪用，占用', '拨出 (专款)'] },
    ],
    options: [
      { pos: 'adj.', text: '恰当的，适宜的', ok: true },
      { pos: 'adj.', text: '激进的；侵略性的' },
      { pos: 'adj.', text: '雄心勃勃的；野心的' },
      { pos: 'adj.', text: '虚假的；人造的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '恰当的，适宜的', ok: true },
      { pos: 'v.', text: '欣赏，感激' }, // appreciate
      { pos: 'adj.', text: '大致的，近似的' }, // approximate
      { pos: 'v.', text: '领会，理解' }, // apprehend
    ],
    sentences: [
      {
        src: '职场礼仪手册',
        theme: 'sky',
        en: 'Please dress in <b>appropriate</b> business attire for the client meeting.',
        zh: '参加客户会议请穿着得体的商务正装。',
      },
    ],
    total: 26,
    def: 'appropriate /əˈproʊpriət/ adj. suitable, acceptable or correct for the particular circumstances 恰当的，适宜的。',
    mnemo: {
      '词组搭配': [
        ['appropriate for/to', '适合于…'],
        ['take appropriate measures', '采取恰当措施'],
      ],
      '词根': [
        ['ap- 去 + propri- 专属，属于自己', '使其归属于恰当的地方 → 合适的'],
        ['appropriately adv.', '适当地，得体地'],
        ['inappropriate adj.', '不适当的，不合时宜的'],
      ],
      '近义': [
        ['suitable adj.', '合适的'],
        ['fitting adj.', '恰当的'],
        ['proper adj.', '正当的，合宜的'],
      ],
    },
  },

  // 31. approve
  {
    id: 'w_approve',
    w: 'approve',
    syl: 'ap·prove',
    ph: '/əˈpruːv/',
    tags: ['CET-4', '高频'],
    senses: [
      { pos: 'v.', items: ['赞成，同意', '批准，通过 (方案/预案)'] },
    ],
    options: [
      { pos: 'v.', text: '赞成；批准，通过', ok: true },
      { pos: 'v.', text: '改善；提高；增进' },
      { pos: 'v.', text: '证明；证实；检验' },
      { pos: 'v.', text: '责怪；非难；指责' },
    ],
    audioOptions: [
      { pos: 'v.', text: '赞成，批准', ok: true },
      { pos: 'v.', text: '改善，提升' }, // improve
      { pos: 'v.', text: '证明，证实' }, // prove
      { pos: 'v.', text: '责备，谴责' }, // reprove
    ],
    sentences: [
      {
        src: '国会法案报道',
        theme: 'city',
        en: 'The committee voted overwhelmingly to <b>approve</b> the new budget proposal.',
        zh: '委员会以压倒性多数投票通过了新的预算案。',
      },
    ],
    total: 31,
    def: 'approve /əˈpruːv/ v. to think that sb/sth is good, acceptable or suitable; to officially agree to 赞成；批准。',
    mnemo: {
      '词组搭配': [
        ['approve of', '赞成…，认可…'],
        ['duly approved', '正式获批'],
      ],
      '词根': [
        ['ap- 去 + prove 证明，证实良好', '证明符合标准并点头 → 赞成，批准'],
        ['approval n.', '赞同，批准'],
        ['disapprove v.', '不赞成，反对'],
      ],
      '近义': [
        ['endorse v.', '背书，赞同'],
        ['sanction v.', '批准，认可'],
        ['authorize v.', '授权，批准'],
      ],
    },
  },

  // 32. artificial
  {
    id: 'w_artificial',
    w: 'artificial',
    syl: 'ar·ti·fi·cial',
    ph: '/ˌɑːrtɪˈfɪʃl/',
    tags: ['CET-4', 'CET-6', '考研', '科技热词'],
    senses: [
      { pos: 'adj.', items: ['人工的，人造的', '假的，模拟的', '虚伪的，做作的'] },
    ],
    options: [
      { pos: 'adj.', text: '人造的；虚伪的', ok: true },
      { pos: 'adj.', text: '雄心勃勃的；野心的' },
      { pos: 'adj.', text: '有益的；有建设性的' },
      { pos: 'adj.', text: '官方的；正式的' },
    ],
    audioOptions: [
      { pos: 'adj.', text: '人造的，人工的', ok: true },
      { pos: 'adj.', text: '有益的，有利的' }, // beneficial
      { pos: 'adj.', text: '肤浅的，表面的' }, // superficial
      { pos: 'adj.', text: '自发的，自然的' }, // spontaneous
    ],
    sentences: [
      {
        src: 'MIT 科技评论',
        theme: 'night',
        en: 'Recent breakthroughs in <b>artificial</b> intelligence have astonished the world.',
        zh: '人工智能领域的近期突破令全世界为之震惊。',
      },
    ],
    total: 32,
    def: 'artificial /ˌɑːrtɪˈfɪʃl/ adj. made or produced by human beings rather than occurring naturally 人工的，人造的。',
    mnemo: {
      '词组搭配': [
        ['artificial intelligence (AI)', '人工智能'],
        ['artificial flowers', '人造假花'],
        ['artificial smile', '做作虚伪的笑容'],
      ],
      '词根': [
        ['art- 技能，技巧 + fic- 做，造', '靠人的技能手艺做出来的 → 人造的，人工的'],
        ['artifice n.', '诡计，巧妙的办法'],
      ],
      '近义': [
        ['synthetic adj.', '合成的，人造的'],
        ['man-made adj.', '人造的'],
        ['fake adj.', '假的'],
      ],
    },
  },

  // 33. assess
  {
    id: 'w_assess',
    w: 'assess',
    syl: 'as·sess',
    ph: '/əˈses/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'vt.', items: ['评估，评定 (价值/能力/风险)', '估价，征税'] },
    ],
    options: [
      { pos: 'vt.', text: '评估，评定；估价', ok: true },
      { pos: 'vt.', text: '进入；存取；获取' },
      { pos: 'vt.', text: '声称；宣称；断言' },
      { pos: 'vt.', text: '吸收；同化；吸引' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '评估，评定', ok: true },
      { pos: 'n./v.', text: '进入，访问' }, // access
      { pos: 'n./v.', text: '过量，过度' }, // excess
      { pos: 'vt.', text: '拥有，占有' }, // possess
    ],
    sentences: [
      {
        src: '灾难应急报告',
        theme: 'city',
        en: 'Engineers are on site to <b>assess</b> the structural integrity of the bridge.',
        zh: '工程师们正在现场评估大桥的结构完整度。',
      },
    ],
    total: 28,
    def: 'assess /əˈses/ vt. to make a judgement about the nature or quality of sb/sth 评估，评定。',
    mnemo: {
      '词组搭配': [
        ['assess the risk', '评估风险'],
        ['assess performance', '评估业绩表现'],
        ['assess the impact', '评估影响'],
      ],
      '词根': [
        ['as- 坐在旁边 + sess- 坐', '法官陪审员坐在旁边估量定夺 → 评估，评定'],
        ['assessment n.', '评估，估定'],
        ['assessor n.', '评估人，估价员'],
      ],
      '近义': [
        ['evaluate v.', '评价，估计'],
        ['appraise v.', '鉴定，估价'],
        ['estimate v.', '估算'],
      ],
    },
  },

  // 34. assume
  {
    id: 'w_assume',
    w: 'assume',
    syl: 'as·sume',
    ph: '/əˈsuːm/',
    tags: ['CET-4', 'CET-6', '考研', '高频'],
    senses: [
      { pos: 'v.', items: ['假定，假设，认为', '承担 (责任/职务)', '呈现 (面貌/特征)'] },
    ],
    options: [
      { pos: 'v.', text: '假定；承担(责任)', ok: true },
      { pos: 'v.', text: '向…保证；确信' },
      { pos: 'v.', text: '消费；消耗；吃光' },
      { pos: 'v.', text: '恢复；重新开始' },
    ],
    audioOptions: [
      { pos: 'v.', text: '假定；承担', ok: true },
      { pos: 'v.', text: '向…保证' }, // assure
      { pos: 'v.', text: '消费，消耗' }, // consume
      { pos: 'v.', text: '重新开始，恢复' }, // resume
    ],
    sentences: [
      {
        src: '神探夏洛克',
        theme: 'night',
        en: 'Never <b>assume</b> anything without verifiable physical evidence.',
        zh: '在没有可检验的实物证据前，绝不要盲目作任何假设。',
      },
      {
        src: '企业公告',
        theme: 'city',
        en: 'She will officially <b>assume</b> the role of CEO starting next Monday.',
        zh: '她将于下周一正式接任首席执行官一职。',
      },
    ],
    total: 35,
    def: 'assume /əˈsuːm/ v. to think or accept that sth is true without question; to take or begin to have responsibility 假定；承担。',
    mnemo: {
      '词组搭配': [
        ['assume responsibility', '承担责任'],
        ['assume control', '接管控制权'],
        ['assume that', '假定…'],
      ],
      '词根': [
        ['as- 去 + sume- 拿取', '自己先拿过来当作真的 → 假设；拿在自己身上 → 承担'],
        ['assumption n.', '假设，设想'],
      ],
      '近义': [
        ['suppose v.', '料想，假定'],
        ['presume v.', '假定，推测'],
        ['undertake v.', '承担，着手'],
      ],
    },
  },

  // 35. assure
  {
    id: 'w_assure',
    w: 'assure',
    syl: 'as·sure',
    ph: '/əˈʃʊr/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'vt.', items: ['使确信，向…保证', '确保，使必然发生'] },
    ],
    options: [
      { pos: 'vt.', text: '向…保证；使确信', ok: true },
      { pos: 'vt.', text: '假定；假设；承担' },
      { pos: 'vt.', text: '确保；给…投保' },
      { pos: 'vt.', text: '吸引；诱惑；引诱' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '向…保证，使确信', ok: true },
      { pos: 'vt.', text: '假定，承担' }, // assume
      { pos: 'vt.', text: '确保，保证' }, // ensure
      { pos: 'vt.', text: '投保，保险' }, // insure
    ],
    sentences: [
      {
        src: '白宫新闻发布会',
        theme: 'city',
        en: 'The spokesperson wished to <b>assure</b> the public that the vaccine is safe.',
        zh: '发言人希望向公众保证该疫苗是安全可靠的。',
      },
    ],
    total: 28,
    def: 'assure /əˈʃʊr/ vt. to tell sb that sth is definitely true or will happen, so that they do not worry 向…保证；使确信。',
    mnemo: {
      '词组搭配': [
        ['assure sb of sth', '向某人保证某事'],
        ['rest assured', '请尽管放心'],
      ],
      '词根': [
        ['as- 去 + sure 确定的', '使对方感到确定无疑 → 向…保证'],
        ['assurance n.', '保证；自信；保险'],
      ],
      '近义': [
        ['guarantee v.', '担保，保证'],
        ['reassure v.', '使安心，打消疑虑'],
        ['convince v.', '使确信'],
      ],
    },
  },

  // 36. astonish
  {
    id: 'w_astonish',
    w: 'astonish',
    syl: 'as·ton·ish',
    ph: '/əˈstɑːnɪʃ/',
    tags: ['CET-4', 'CET-6', '考研'],
    senses: [
      { pos: 'vt.', items: ['使十分惊讶，使大吃一惊，使震惊'] },
    ],
    options: [
      { pos: 'vt.', text: '使震惊，使大吃一惊', ok: true },
      { pos: 'vt.', text: '建立；确立；安置' },
      { pos: 'vt.', text: '完成；达成；实现' },
      { pos: 'vt.', text: '鼓励；激励；鼓舞' },
    ],
    audioOptions: [
      { pos: 'vt.', text: '使震惊，使吃惊', ok: true },
      { pos: 'vt.', text: '建立，确立' }, // establish
      { pos: 'vt.', text: '使大为惊奇' }, // astound
      { pos: 'vt.', text: '完成，实现' }, // accomplish
    ],
    sentences: [
      {
        src: '哈利波特',
        theme: 'night',
        en: 'His incredible magic skills never failed to <b>astonish</b> everyone in the room.',
        zh: '他不可思议的魔法技艺总能让房间里的每一个人大吃一惊。',
      },
    ],
    total: 21,
    def: 'astonish /əˈstɑːnɪʃ/ vt. to surprise sb very much; to amaze 使十分惊讶，使震惊。',
    mnemo: {
      '词组搭配': [
        ['astonish everyone', '令所有人震惊'],
        ['be astonished at/by', '对…感到十分惊讶'],
      ],
      '词根': [
        ['as- 像雷鸣 + ton- 打雷，雷声', '如同晴天霹雳雷击般震惊 → 使大吃一惊'],
        ['astonishing adj.', '令人震惊的，惊人的'],
        ['astonishment n.', '惊讶，惊奇'],
      ],
      '近义': [
        ['amaze v.', '使惊奇'],
        ['surprise v.', '使吃惊'],
        ['astound v.', '使震骇'],
      ],
    },
  },
];
