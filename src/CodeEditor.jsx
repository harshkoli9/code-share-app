import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";

const languageLoaders = {
  javascript: () => import("@codemirror/lang-javascript").then((module) => module.javascript),
  python: () => import("@codemirror/lang-python").then((module) => module.python),
  html: () => import("@codemirror/lang-html").then((module) => module.html),
  css: () => import("@codemirror/lang-css").then((module) => module.css),
  markdown: () => import("@codemirror/lang-markdown").then((module) => module.markdown),
};

export default function CodeEditor({ value, onChange, language, theme }) {
  const [languageExtension, setLanguageExtension] = useState(null);
  useEffect(() => {
    let active = true;
    setLanguageExtension(null);
    const loadLanguage = languageLoaders[language];
    if (loadLanguage) loadLanguage().then((extension) => { if (active) setLanguageExtension(extension); });
    return () => { active = false; };
  }, [language]);

  return <CodeMirror
    value={value}
    onChange={onChange}
    extensions={languageExtension ? [languageExtension()] : []}
    theme={theme}
    minHeight="250px"
    maxHeight="520px"
    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, tabSize: 2 }}
  />;
}
