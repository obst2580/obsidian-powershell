declare module "electron" {
  export const clipboard: {
    writeText(text: string): void;
  };
}
