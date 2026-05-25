import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installConsoleCapture } from "./lib/devlog";

installConsoleCapture();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
