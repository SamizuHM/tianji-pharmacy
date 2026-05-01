import { redirect } from "next/navigation";

import { ChatClient } from "@/components/chat/chat-client";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
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
    <ChatClient
      conversationId={activeConversation.id}
      conversations={conversations}
      messages={messages}
      serviceHotline={env.SERVICE_HOTLINE}
    />
  );
}
