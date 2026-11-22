import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && !env.VITE_SERVER_URL) {
    throw new Error("Defina VITE_SERVER_URL com a URL HTTPS pública do servidor antes do build de produção.");
  }
  return { plugins: [react()], server: { host: "0.0.0.0" } };
});