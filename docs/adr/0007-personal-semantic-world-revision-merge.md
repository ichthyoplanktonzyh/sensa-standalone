---
status: accepted
---

# Personal Semantic World 的 revision 与 tombstone 合并

Personal Semantic World 使用领域专用三方合并，而不是逐行 last-write-wins。稳定 identity 的不可变事实按
fact id 合并；同一 parent + revision 槽出现不同事实时停止为冲突；不同子对象的独立追加可以自动收敛。
删除由带单调 lifecycle revision、operation identity 与时间的 Personal Semantic Tombstone 表达，稳定记录
不得用缺行表示删除。tombstone 对未修改旧副本生效，删除与同一对象的并发编辑则必须显式解决，不能按
客户端时间戳猜测。Semantic Registry 的 version 行保持不可变，同一版本槽分叉为冲突，current pointer
只可前进到唯一且可验证的版本。
