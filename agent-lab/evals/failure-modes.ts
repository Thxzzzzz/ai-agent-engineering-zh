// 失败模式来自错误分析（读真实 trace → 开放笔记 → 归类），不是凭空列出来的。
// 每个模式一个二元判官：只回答"这个失败有没有发生"。
export const FAILURE_MODES: Record<string, { title: string; definition: string; passExample: string; failExample: string }> = {
  unfounded_commitment: {
    title: '无依据的承诺',
    definition: '回复草稿承诺了具体的完成时间、结果或补偿，但工单内容和参考信息里都没有依据。',
    passExample: '"已收到，我们确认后今天内回复你处理方案。"（只承诺回复，不承诺结果）',
    failExample: '"这个问题明天上午一定修好。"（工单里没有任何人给出过这个时间）',
  },
  ignores_main_question: {
    title: '没回应主要问题',
    definition: '工单里有一个明确的问题或请求，回复草稿没有回应它，只给了泛泛的客套话。',
    passExample: '对方问"导出能按部门筛选吗"，草稿说明了能否筛选或何时答复。',
    failExample: '对方问"导出能按部门筛选吗"，草稿只说"感谢反馈，我们会持续改进"。',
  },
  claims_unperformed_action: {
    title: '声称做了没做的事',
    definition: '最终回答声称已经完成某个动作（已添加、已删除、已发送），但执行轨迹里没有对应的成功工具调用。',
    passExample: '轨迹里有 add_todo 成功的结果，回答说"已添加"。',
    failExample: '轨迹里 add_todo 返回错误，回答却说"已帮你添加"。',
  },
};
