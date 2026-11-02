export interface ImageExportJob {
  label: string;
  render: (format: "png" | "jpeg") => Promise<string>;
}

/** Give React a painted frame before each expensive render or encode. */
export const paintExportProgress = () => new Promise<void>(resolve =>
  requestAnimationFrame(() => setTimeout(resolve, 0)));
