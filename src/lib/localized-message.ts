import { formatCommandError, parseCommandError, type CommandError } from "$lib/command-error";
import { translate } from "$lib/i18n";

export type LocalizedMessage =
  | {
      kind: "translation";
      key: string;
      params?: Record<string, string | number>;
    }
  | {
      kind: "commandError";
      error: CommandError | null;
      wrapperKey?: string;
    }
  | {
      kind: "list";
      messages: LocalizedMessage[];
      separator: string;
    };

export function translationMessage(
  key: string,
  params?: Record<string, string | number>,
): LocalizedMessage {
  return { kind: "translation", key, params };
}

export function commandErrorMessage(error: unknown, wrapperKey?: string): LocalizedMessage {
  return {
    kind: "commandError",
    error: parseCommandError(error),
    wrapperKey,
  };
}

export function messageList(messages: LocalizedMessage[], separator = " · "): LocalizedMessage {
  return { kind: "list", messages, separator };
}

export function formatLocalizedMessage(message: LocalizedMessage): string {
  switch (message.kind) {
    case "translation":
      return translate(message.key, message.params);
    case "commandError": {
      const error = formatCommandError(message.error);
      return message.wrapperKey ? translate(message.wrapperKey, { error }) : error;
    }
    case "list":
      return message.messages.map(formatLocalizedMessage).join(message.separator);
  }
}
