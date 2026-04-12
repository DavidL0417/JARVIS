// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { parseAssistantMessage } from "@/lib/ai/claude-parser"
import { handleParsedInput } from "@/lib/assistant/handleParsedInput"
import {
  assistantMessageRequestSchema,
  assistantMessageResponseSchema,
  createFallbackParsedAssistantInput,
} from "@/lib/ai/parser-schema"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { getCurrentDayContext } from "@/lib/time/current-day"

const IS_DEV = process.env.NODE_ENV !== "production"

// Parsing + DB action bridge only. Scheduling and Google Calendar integration are intentionally deferred.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = assistantMessageRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        ok: false,
        rawMessage: "",
        parsed: createFallbackParsedAssistantInput(),
        error: "Invalid assistant message request.",
      },
      { status: 400 },
    )
  }

  const trimmedMessage = parsedBody.data.message

  try {
    const dayContext = getCurrentDayContext({
      now: parsedBody.data.now,
      timezone: parsedBody.data.timezone,
    })

    const parserResult = await parseAssistantMessage({
      ...parsedBody.data,
      message: trimmedMessage,
      now: dayContext.nowIso,
      timezone: dayContext.timezone,
      currentDay: dayContext.currentDay,
    })

    const { adminClient, user } = await requireAuthenticatedUser()
    const handlerResult = await handleParsedInput({
      userId: user.id,
      parsed: parserResult.parsed,
      supabase: adminClient,
    })

    const responsePayload = {
      ok: handlerResult.success,
      rawMessage: trimmedMessage,
      parsed: parserResult.parsed,
      actionsTaken: handlerResult.actionsTaken,
      ...(!handlerResult.success ? { error: "Failed to apply assistant input." } : {}),
      ...(IS_DEV
        ? {
            debug: {
              parserStage: parserResult.parserStage,
              ...(parserResult.errorCode ? { errorCode: parserResult.errorCode } : {}),
            },
          }
        : {}),
    }

    const parsedResponse = assistantMessageResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          ok: false,
          rawMessage: trimmedMessage,
          parsed: createFallbackParsedAssistantInput(),
          actionsTaken: [],
          error: "Invalid assistant parser response.",
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedResponse.data, {
      status: handlerResult.success ? 200 : 500,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json(
        {
          ok: false,
          rawMessage: trimmedMessage,
          parsed: createFallbackParsedAssistantInput(),
          actionsTaken: [],
          error: "Authentication required.",
        },
        { status: 401 },
      )
    }

    const errorMessage = error instanceof Error ? error.message : ""
    const message =
      errorMessage.includes("ANTHROPIC_API_KEY") ||
      errorMessage.includes("Supabase environment variable")
        ? errorMessage
        : "Failed to parse assistant input."

    return NextResponse.json(
      {
        ok: false,
        rawMessage: trimmedMessage,
        parsed: createFallbackParsedAssistantInput(),
        actionsTaken: [],
        error: message,
        ...(IS_DEV
          ? {
              debug: {
                parserStage: "fallback" as const,
                errorCode: "parse_error" as const,
              },
            }
          : {}),
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
