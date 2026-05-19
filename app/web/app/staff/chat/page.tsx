import { ChatClient } from "@/components/chat/chat-client";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getConversationList, getConversationMessages } from "@/lib/services/conversations";

export default async function StaffChatPage(props: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  const user = await requireUser(["staff"]);
  const conversations = await getConversationList(user.id);

  const searchParams = await props.searchParams;
  const activeConversation =
    conversations.find((item) => item.id === searchParams.conversationId) ?? null;

  const messages = activeConversation ? await getConversationMessages(activeConversation.id) : [];

  return (
    <ChatClient
      conversationId={activeConversation?.id ?? null}
      conversations={conversations}
      messages={messages}
      serviceHotline={env.SERVICE_HOTLINE}
    />
  );
}
