---
status: accepted
---

# 以三个产品系统组织 Sensa 领域架构

Sensa 的顶层产品架构由 **Personal Semantic World、Learning System 与 Content Supply System**
组成；三者引用共同的 **Semantic Foundation**，其 learner-facing state 与运行位于 **Local-first
Platform** 上。这个划分按事实
归属与变化语义组织产品，而不是按页面、客户端、数据库或在线服务组织。Product Shell、Learning
Kernel 与 Production Base 仍可描述软件职责层次，但它们与三个产品系统正交，不能替代领域划分。

Personal Semantic World 产品系统拥有 learner 接受的 Personal Meaning、Anchors、Alignments，以及与
之相邻但保持独立生命周期的 Personal Content。其内部 Personal Semantic World Module 只接纳完整、
已接受的语义事实；Personal Content Module 单独拥有 Saved references、Sense Note、Sense Context Note、
Collection 与 Personal Learning Scene，并引用而不拥有 stable Sense/Expression identities。Learning System 包含 Curriculum、
Policy、Planning、Provisioning handoff、Runtime、Progress 与 Scheduling；正式学习可以从 Book、direct
stable-Sense 或 personal-first bridge 进入。Content Supply System 包含 Published、On-demand 与 Hybrid
内容的生产、验证、发布、分发、安装和 Materialization，但不拥有 Learning Policy、Protocol、learner
progress 或 FSRS。

因此三个系统可以物理共用一个本地事务库或 Cloud Checkpoint，却必须保留不同的数据语义：个人语义
事实使用版本化对象与领域合并；学习以不可改写的结算历史和合并裁决为权威、以当前进度和调度为投影；
发布内容以 immutable release/version/digest 为权威，并把发现、下载、安装与应用分开。Obsidian、Anki
与 package registry 只提供相应机制的成熟经验，不定义 Sensa 的文件、Card/Deck 或依赖模型。

**Intake Layer** 是连接真实场景与上述产品系统的统一入口层，而不是第四个事实系统。Intake Surface、
本机/远程 adapter 与 Semantic Intake Module 共用一个 port-neutral payload 和 intake interface；未闭合
事实由 Intake Inbox 暂存，完整且获有效 Semantic Acceptance 的事实交给 Personal Semantic World，
而 Add-to-Learning 仍是进入 Learning System 的独立 command。Remote Intake Delivery 只拥有 mailbox
与 `queued | applied` 传输回执，不能取得 Semantic Acceptance 或 Personal Meaning 的所有权。
