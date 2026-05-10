declare module "electron" {
  interface NativeImage {
    isEmpty(): boolean;
    toPNG(): Buffer;
  }

  export const clipboard: {
    writeText(text: string): void;
    readText(): string;
    readImage(): NativeImage;
  };
}
