import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installConsoleCapture } from "./lib/devlog";
import { applyTheme, getStoredTheme } from "./lib/theme";

installConsoleCapture();
// Apply persisted theme before React mounts so the first paint already
// uses the user's chosen accent colors (no flash of default theme).
applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
