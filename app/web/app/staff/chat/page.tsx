import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { ChatClient } from "@/components/chat/chat-client";
import { requireUser } from "@/lib/auth/session";
import { createConversation, getConversationList, getConversationMessages } from "@/lib/services/conversations";

export default async function StaffChatPage(props: { searchParams: Promise<{ conversationId?: string }> }) {
  const user = await requireUser(["staff"]);
  let conversations = await getConversationList(user.id);

  if (!conversations.length) {
    await createConversation(user.id, "新会话");
    conversations = await getConversationList(user.id);
  }

  const searchParams = await props.searchParams;
  const activeConversation = conversations.find((item) => item.id === searchParams.conversationId) ?? conversations[0];

  if (!activeConversation) {
    redirect("/login");
  }

  const messages = await getConversationMessages(activeConversation.id);

  return (
    <AppShell
      role={user.role}
      displayName={user.displayName}
      title="药店工作人员问答台"
      description="先检索知识库，未命中再走大模型。每轮回答后都支持一键转人工。"
    >
      <ChatClient conversationId={activeConversation.id} conversations={conversations} messages={messages} />
    </AppShell>
  );
}

