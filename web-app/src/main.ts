import { mount } from "svelte";

import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("ImgConvert Web mount target is missing.");

const app = mount(App, { target });

export default app;
