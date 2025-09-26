import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

const editTelegramMessageWithResult = async ({
  chatId,
  messageId,
  originalMessage,
  matchResult,
  logger,
}: {
  chatId: string;
  messageId: number;
  originalMessage: string;
  matchResult: {
    fixtureId: number;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    status: string;
    predictions: {
      prediction: string;
      outcome: "success" | "failed";
      icon: "✅" | "❌";
    }[];
  };
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [EditTelegramMessage] Starting message editing", { 
    chatId,
    messageId,
    homeTeam: matchResult.homeTeam,
    awayTeam: matchResult.awayTeam,
    predictions: matchResult.predictions.length
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  try {
    // Add match result to the original message
    const matchInfo = `${matchResult.homeTeam} ${matchResult.homeScore}-${matchResult.awayScore} ${matchResult.awayTeam}`;
    const totalGoals = matchResult.homeScore + matchResult.awayScore;
    
    logger?.info("📝 [EditTelegramMessage] Processing match result", {
      matchInfo,
      totalGoals,
      status: matchResult.status
    });

    // Create results summary
    let resultSummary = `\n\n🏆 <b>RESULTADO:</b>\n`;
    resultSummary += `⚽ ${matchInfo} (${matchResult.status})\n`;
    
    if (matchResult.predictions && matchResult.predictions.length > 0) {
      resultSummary += `\n📊 <b>PREVISÕES:</b>\n`;
      matchResult.predictions.forEach(pred => {
        resultSummary += `${pred.icon} ${pred.prediction}\n`;
      });
      
      const successCount = matchResult.predictions.filter(p => p.outcome === "success").length;
      const successRate = Math.round((successCount / matchResult.predictions.length) * 100);
      
      resultSummary += `\n🎯 Taxa de acerto: ${successRate}% (${successCount}/${matchResult.predictions.length})\n`;
    }

    // Find the match in the original message and add results
    let updatedMessage = originalMessage;
    
    // Look for the match in the message
    const matchPattern = new RegExp(`${matchResult.homeTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} vs ${matchResult.awayTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    
    if (matchPattern.test(originalMessage)) {
      // Add result summary at the end of the message
      updatedMessage = originalMessage + resultSummary;
    } else {
      // If match not found in message, add at the end anyway
      resultSummary = `\n\n⚽ <b>ATUALIZAÇÃO DE JOGO:</b>\n` + 
                     `🏆 ${matchInfo} (${matchResult.status})\n` + 
                     resultSummary;
      updatedMessage = originalMessage + resultSummary;
    }

    updatedMessage += `\n\n⏰ <i>Atualizado: ${new Date().toLocaleString('pt-PT')}</i>`;

    logger?.info("📝 [EditTelegramMessage] Editing message", {
      originalLength: originalMessage.length,
      updatedLength: updatedMessage.length
    });

    // Edit the message
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/editMessageText`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: updatedMessage,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      
      // If message is too old to edit, send a new message instead
      if (errorData.error_code === 400 && errorData.description?.includes("message to edit not found")) {
        logger?.warn("📝 [EditTelegramMessage] Message too old to edit, sending new message");
        
        const newMessageResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: chatId,
              text: resultSummary,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
          }
        );

        if (newMessageResponse.ok) {
          const newMessageData = await newMessageResponse.json();
          logger?.info("✅ [EditTelegramMessage] New message sent successfully", {
            newMessageId: newMessageData.result.message_id
          });
          
          return {
            success: true,
            edited: false,
            newMessage: true,
            messageId: newMessageData.result.message_id,
            chatId,
            updatedAt: new Date().toISOString(),
          };
        }
      }
      
      throw new Error(`Telegram API error: ${response.status} - ${errorData.description || response.statusText}`);
    }

    const responseData = await response.json();

    logger?.info("✅ [EditTelegramMessage] Message edited successfully", {
      messageId,
      chatId
    });

    return {
      success: true,
      edited: true,
      newMessage: false,
      messageId,
      chatId,
      updatedAt: new Date().toISOString(),
    };

  } catch (error) {
    logger?.error("❌ [EditTelegramMessage] Error occurred", {
      error: error instanceof Error ? error.message : String(error),
      chatId,
      messageId
    });
    throw error;
  }
};

export const editTelegramMessageTool = createTool({
  id: "edit-telegram-message",
  description: "Edits a Telegram message to add match results with ✅ or ❌ based on prediction outcomes",
  inputSchema: z.object({
    chatId: z.string().describe("The chat ID where the message was sent"),
    messageId: z.number().describe("The message ID to edit"),
    originalMessage: z.string().describe("The original message content"),
    matchResult: z.object({
      fixtureId: z.number(),
      homeTeam: z.string(),
      awayTeam: z.string(),
      homeScore: z.number(),
      awayScore: z.number(),
      status: z.string(),
      predictions: z.array(z.object({
        prediction: z.string(),
        outcome: z.enum(["success", "failed"]),
        icon: z.enum(["✅", "❌"]),
      })),
    }),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    edited: z.boolean(),
    newMessage: z.boolean(),
    messageId: z.number(),
    chatId: z.string(),
    updatedAt: z.string(),
  }),
  execute: async ({ context: { chatId, messageId, originalMessage, matchResult }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [EditTelegramMessage] Starting execution with params", {
      chatId,
      messageId,
      homeTeam: matchResult.homeTeam,
      awayTeam: matchResult.awayTeam
    });
    
    return await editTelegramMessageWithResult({ 
      chatId, 
      messageId, 
      originalMessage, 
      matchResult, 
      logger 
    });
  },
});