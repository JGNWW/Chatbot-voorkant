import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Stuur API-verzoeken door naar de FastAPI-backend tijdens ontwikkeling.
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
