declare module "electron" {
  export const clipboard: {
    readText(): string;
    writeText(text: string): void;
  };
}
