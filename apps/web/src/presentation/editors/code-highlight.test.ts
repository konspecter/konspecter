import { EditorState as SourceState } from "@codemirror/state";
import { EditorView as SourceView } from "@codemirror/view";
import { EditorView } from "prosemirror-view";
import { codeLanguage } from "./code-highlight";
import { createSourceExtensions } from "./MarkdownSourceEditor";
import { createTextEditorState } from "./text-editor-setup";
import { textMarkdownParser } from "./text-schema";

function textEditorWith(markdown: string) {
  const mount = document.createElement("div");
  const view = new EditorView(mount, {
    state: createTextEditorState(textMarkdownParser.parse(markdown)),
  });
  return { view, mount };
}

/** The text of every element in `root` with the class, in order. */
const classed = (root: Element, className: string) =>
  [...root.querySelectorAll(`.${className}`)].map((element) => element.textContent);

describe("code languages", () => {
  it.each([
    ["go", "Go"],
    ["java", "Java"],
    ["kotlin", "Kotlin"],
    ["ts", "TypeScript"],
    ["Python", "Python"],
    ["sh", "Shell"],
    ['js title="x.js"', "JavaScript"],
    ["php", "PHP"],
    ["c", "C"],
    ["cpp", "C++"],
    ["c++", "C++"],
    ["cs", "C#"],
    ["c#", "C#"],
    ["csharp", "C#"],
  ])("finds the grammar for ```%s", (info, name) => {
    expect(codeLanguage(info)?.name).toBe(name);
  });

  it("finds none for an empty or unknown info string", () => {
    expect(codeLanguage("")).toBeNull();
    expect(codeLanguage("no-such-language")).toBeNull();
  });
});

describe("code highlighting in the text editor", () => {
  it("highlights a code block once its grammar has loaded", async () => {
    const { mount } = textEditorWith('```go\nfunc main() {\n\treturn "x"\n}\n```');

    await vi.waitFor(() => {
      expect(classed(mount, "tok-keyword")).toEqual(["func", "return"]);
    });
    expect(classed(mount, "tok-string")).toEqual(['"x"']);
    expect(mount.querySelector("pre")?.textContent).toBe('func main() {\n\treturn "x"\n}');
  });

  it("highlights a grammar that is already loaded at once, and follows edits", async () => {
    await codeLanguage("java")?.load();
    const { view, mount } = textEditorWith("```java\nint x;\n```");
    expect(classed(mount, "tok-type")).toEqual(["int"]);

    view.dispatch(view.state.tr.insertText("class ", 1));
    expect(classed(mount, "tok-keyword")).toEqual(["class"]);
  });

  it.each([
    ["php", "$x = 1;\nfunction f() { return 'a'; }", ["function", "return"]],
    ["php", "<?php\necho 'x';", ["echo"]],
    ["c", "int main(void) { return 0; }", ["return"]],
    ["c++", "class A { public: int x; };", ["class", "public"]],
    ["c#", "public class A { }", ["public", "class"]],
  ])("highlights ```%s: %s", async (info, code, keywords) => {
    await codeLanguage(info)?.load();
    const { mount } = textEditorWith(`\`\`\`${info}\n${code}\n\`\`\``);

    expect(classed(mount, "tok-keyword")).toEqual(keywords);
  });

  it("makes a code block of ```c++ or ```c# typed in the text", () => {
    for (const info of ["c++", "c#"]) {
      const { view } = textEditorWith("x");
      view.dispatch(view.state.tr.delete(1, 2));
      for (const key of `\`\`\`${info} `) {
        const pos = view.state.selection.from;
        const handled = view.someProp("handleTextInput", (handle) =>
          handle(view, pos, pos, key, () => view.state.tr.insertText(key, pos, pos)),
        );
        if (!handled) view.dispatch(view.state.tr.insertText(key, pos, pos));
      }
      expect(view.state.doc.firstChild?.type.name).toBe("code_block");
      expect(view.state.doc.firstChild?.attrs.params).toBe(info);
    }
  });

  it("leaves code without a known language plain", () => {
    const { mount } = textEditorWith("```\nfunc main() {}\n```\n\n```nonsense\nint x;\n```");

    expect(mount.querySelector("[class^=tok-]")).toBeNull();
  });

  it("highlights a block whose language is set after it was written", async () => {
    await codeLanguage("go")?.load();
    const { view, mount } = textEditorWith("```\nfunc f() {}\n```");

    view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { params: "go" }));
    expect(classed(mount, "tok-keyword")).toEqual(["func"]);
  });
});

describe("code highlighting in the Markdown editor", () => {
  it("uses the same token classes for fenced code", async () => {
    await codeLanguage("go")?.load();
    const view = new SourceView({
      parent: document.body,
      state: SourceState.create({
        doc: "# Go\n\n```go\nfunc main() {}\n```\n",
        extensions: createSourceExtensions(() => undefined),
      }),
    });

    await vi.waitFor(() => {
      expect(classed(view.contentDOM, "tok-keyword")).toEqual(["func"]);
    });
    view.destroy();
  });

  it("draws code blocks under the selection, not as line backgrounds", async () => {
    const view = new SourceView({
      parent: document.body,
      state: SourceState.create({
        doc: "text\n\n```\none\ntwo\n```\n\n    indented\n",
        extensions: createSourceExtensions(() => undefined),
      }),
    });

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll(".cm-code-blocks .cm-code-block")).toHaveLength(2);
    });
    const layers = [...view.scrollDOM.querySelectorAll<HTMLElement>(".cm-layer")];
    const z = (name: string) =>
      Number(layers.find((layer) => layer.classList.contains(name))?.style.zIndex);
    expect(z("cm-code-blocks")).toBeLessThan(z("cm-selectionLayer"));
    expect(view.contentDOM.querySelectorAll(".cm-code-line")).toHaveLength(5);
    view.destroy();
  });
});
