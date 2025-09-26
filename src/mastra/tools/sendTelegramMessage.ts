import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

const sendTelegramMessageToUserAndChannel = async ({
  message,
  chatId,
  logger,
}: {
  message: string;
  chatId?: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [SendTelegramMessage] Starting execution", { 
    messageLength: message.length,
    chatId: chatId ? "provided" : "not provided",
    hasChannelId: !!process.env.TELEGRAM_CHANNEL_ID
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  const results = [];
  let errors = [];

  try {
    // Send to private chat first
    let targetChatId = chatId;

    // If no chat ID provided, we need to get updates to find the user's chat ID
    if (!targetChatId) {
      logger?.info("📝 [SendTelegramMessage] No chat ID provided, fetching updates to find user");
      
      try {
        const updatesResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/getUpdates?limit=10&offset=-10`
        );

        if (updatesResponse.ok) {
          const updatesData = await updatesResponse.json();
          
          if (updatesData.result && updatesData.result.length > 0) {
            // Get the most recent chat ID from a private message
            const privateMessage = updatesData.result
              .reverse()
              .find((update: any) => update.message?.chat?.type === 'private');
            
            if (privateMessage) {
              targetChatId = privateMessage.message.chat.id.toString();
              logger?.info("📝 [SendTelegramMessage] Found chat ID from recent messages", { 
                chatId: targetChatId 
              });
            }
          }
        }
      } catch (updateError) {
        logger?.warn("⚠️ [SendTelegramMessage] Could not fetch updates for private chat", {
          error: updateError instanceof Error ? updateError.message : String(updateError)
        });
      }
    }

    // Try to send to private chat if we have a chat ID
    if (targetChatId) {
      try {
        logger?.info("📝 [SendTelegramMessage] Sending message to private chat", { 
          chatId: targetChatId,
          messageLength: message.length 
        });

        const privateResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: message,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
          }
        );

        if (privateResponse.ok) {
          const privateData = await privateResponse.json();
          results.push({
            type: "private_chat",
            success: true,
            messageId: privateData.result?.message_id,
            chatId: targetChatId,
          });
          logger?.info("✅ [SendTelegramMessage] Message sent to private chat successfully", { 
            messageId: privateData.result?.message_id,
            chatId: targetChatId 
          });
        } else {
          const errorData = await privateResponse.json();
          errors.push(`Private chat error: ${privateResponse.status} - ${errorData.description || privateResponse.statusText}`);
          logger?.error("❌ [SendTelegramMessage] Failed to send to private chat", {
            error: errorData.description || privateResponse.statusText
          });
        }
      } catch (privateError) {
        errors.push(`Private chat error: ${privateError instanceof Error ? privateError.message : String(privateError)}`);
        logger?.error("❌ [SendTelegramMessage] Exception sending to private chat", {
          error: privateError instanceof Error ? privateError.message : String(privateError)
        });
      }
    } else {
      logger?.warn("⚠️ [SendTelegramMessage] No private chat ID available");
      errors.push("No private chat ID available. Please send a message to the bot first.");
    }

    // Send to channel if channel ID is provided
    if (channelId) {
      try {
        logger?.info("📝 [SendTelegramMessage] Sending message to channel", { 
          channelId,
          messageLength: message.length 
        });

        const channelResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: channelId,
              text: message,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
          }
        );

        if (channelResponse.ok) {
          const channelData = await channelResponse.json();
          results.push({
            type: "channel",
            success: true,
            messageId: channelData.result?.message_id,
            chatId: channelId,
          });
          logger?.info("✅ [SendTelegramMessage] Message sent to channel successfully", { 
            messageId: channelData.result?.message_id,
            channelId 
          });
        } else {
          const errorData = await channelResponse.json();
          errors.push(`Channel error: ${channelResponse.status} - ${errorData.description || channelResponse.statusText}`);
          logger?.error("❌ [SendTelegramMessage] Failed to send to channel", {
            error: errorData.description || channelResponse.statusText
          });
        }
      } catch (channelError) {
        errors.push(`Channel error: ${channelError instanceof Error ? channelError.message : String(channelError)}`);
        logger?.error("❌ [SendTelegramMessage] Exception sending to channel", {
          error: channelError instanceof Error ? channelError.message : String(channelError)
        });
      }
    } else {
      logger?.info("📝 [SendTelegramMessage] No channel ID provided, skipping channel send");
    }

    // Return results
    if (results.length === 0) {
      throw new Error(`Failed to send to any destination. Errors: ${errors.join('; ')}`);
    }

    const mainResult = results.find(r => r.type === "private_chat") || results[0];
    
    logger?.info("✅ [SendTelegramMessage] Completed", { 
      sentTo: results.length,
      errors: errors.length,
      results: results.map(r => ({ type: r.type, success: r.success }))
    });

    return {
      success: true,
      messageId: mainResult.messageId,
      chatId: mainResult.chatId,
      sentAt: new Date().toISOString(),
      results,
      errors: errors.length > 0 ? errors : undefined,
    };

  } catch (error) {
    logger?.error("❌ [SendTelegramMessage] Critical error occurred", { 
      error: error instanceof Error ? error.message : String(error),
      allErrors: errors
    });
    throw error;
  }
};

export const sendTelegramMessageTool = createTool({
  id: "send-telegram-message",
  description: "Sends a formatted message to a Telegram user/chat with football predictions and analysis",
  inputSchema: z.object({
    message: z.string().describe("The message content to send"),
    chatId: z.string().optional().describe("Optional specific chat ID to send to. If not provided, will use the most recent private chat."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    chatId: z.string(),
    sentAt: z.string(),
    results: z.array(z.object({
      type: z.string(),
      success: z.boolean(),
      messageId: z.number().optional(),
      chatId: z.string(),
    })),
    errors: z.array(z.string()).optional(),
  }),
  execute: async ({ context: { message, chatId }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [SendTelegramMessage] Starting execution with params", { 
      messageLength: message.length,
      hasChatId: !!chatId 
    });
    
    return await sendTelegramMessageToUserAndChannel({ message, chatId, logger });
  },
});