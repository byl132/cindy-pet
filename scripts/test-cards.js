// 卡片识别自测：用 Windows 上抓到的真实界面结构（精简版）验证 ui-cards.js 能认出提问卡和命令确认卡。
const { parseCards } = require('../ui-cards.js');
const B = (d, n) => ({ d, t: 'Button', n }), T = (d, n) => ({ d, t: 'Text', n });
const question = [
  T(20, '测试题'), B(19, '收起问题卡片'), T(19, '请选一个方案'),
  B(19, '甲方案 先试这个 1'), T(21, '甲方案'), T(21, '先试这个'), T(20, '1'),
  B(19, '乙方案 另一个 2'), T(21, '乙方案'), T(21, '另一个'), T(20, '2'),
  B(19, '输入其他回答… 3'), T(20, '输入其他回答…'), T(20, '3'), B(19, '开始语音输入'), B(19, '跳过')
];
const permission = [
  T(10, '允许运行这条命令？'), T(10, 'rm -rf build'), T(10, '自动审批需要你决定：会删除一个目录'), T(10, 'cd /tmp && rm -rf build'),
  B(10, '拒绝 Esc'), T(11, '拒绝'), T(11, 'Esc'), B(10, '允许一次 Enter'), T(11, '允许一次'), T(11, 'Enter')
];
let bad = 0; const check = (c, m) => { if (!c) { console.log('FAIL', m); bad++; } };
const q = parseCards(question);
check(q.length === 1 && q[0].kind === 'question', '提问卡数量');
check(q[0] && q[0].question === '请选一个方案' && q[0].header === '测试题', '提问卡标题');
check(q[0] && q[0].options.map((o) => o.label).join() === '甲方案,乙方案', '提问卡选项');
check(q[0] && q[0].options[0].description === '先试这个', '选项说明');
const p = parseCards(permission);
check(p.length === 1 && p[0].kind === 'permission', '确认卡数量');
check(p[0] && p[0].title === '允许运行这条命令？' && /rm -rf build/.test(p[0].body), '确认卡内容');
check(p[0] && permission[p[0].allowIdx].n.startsWith('允许一次') && permission[p[0].denyIdx].n.startsWith('拒绝'), '确认卡按钮');
check(parseCards([T(0, '随便聊聊'), B(0, '发送')]).length === 0, '普通界面不应识别出卡片');
console.log(bad ? '卡片识别自测失败 ' + bad : '卡片识别自测通过');
process.exit(bad ? 1 : 0);
