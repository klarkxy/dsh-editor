declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage<T extends { readonly source: unknown; readonly content: unknown }>(
    input: T & { readonly id?: never; readonly role?: never },
  ): T & { readonly id: string; readonly role: 'user' }
}
