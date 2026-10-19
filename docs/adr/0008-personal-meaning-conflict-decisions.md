---
status: accepted
---

# 个人意义冲突采用保留父分支的账号级决议

一次设备上的明确选择应让仍持有已审阅版本的其他设备收敛，而不删除双方的语义历史。因此保留精确父分支快照，
以不可变决议选出当前分支；普通后续编辑仍沿当前分支追加，不重新编号或拼接两个分支的 revision 槽。
这采用 [Git 多父合并记录](https://git-scm.com/docs/git-merge) 的历史保留范式，但限定在 Sensa 的 Personal Meaning，
不引入通用版本控制或重做同步协议。拒绝逐设备反复裁决、last-write-wins，以及为收敛而放宽不可变事实保护。

本决议补充 [ADR 0007](0007-personal-semantic-world-revision-merge.md) 的 revision／三方合并边界，固定冲突选择如何跨设备传播；不取代原有不可变事实保护。
