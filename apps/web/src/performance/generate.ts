/** Realistic synthetic notes for performance measurements. */
const WORDS =
  "array list hash map tree set queue stack graph node edge index query cache buffer stream thread lock future promise channel socket packet route table column schema migration transaction".split(
    " ",
  );

function words(n: number, seed: number): string {
  let out = "";
  for (let i = 0; i < n; i += 1) out += `${WORDS[(seed * 31 + i * 17) % WORDS.length] ?? "x"} `;
  return out.trim();
}

/** A note of roughly `kilobytes` KB with headings, lists, code and tags. */
export function syntheticNote(index: number, kilobytes = 4): string {
  const sections: string[] = [
    `---\ntitle: Note ${String(index)} about ${words(2, index)}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-0${String((index % 9) + 1)}-01T00:00:00Z\n---\n`,
    `# Note ${String(index)}`,
    `#topic${String(index % 20)}#sub${String(index % 5)} #lang${String(index % 7)}`,
  ];
  let size = sections.join("\n").length;
  let part = 0;
  while (size < kilobytes * 1024) {
    const block =
      part % 3 === 0
        ? `## Section ${String(part)}\n\n${words(60, index + part)}.`
        : part % 3 === 1
          ? `- ${words(8, part)}\n- ${words(8, part + 1)}\n- ${words(8, part + 2)}`
          : "```java\n" +
            `var ${words(1, part)} = new HashMap<String, Integer>(); // ${words(6, part)}\n` +
            "```";
    sections.push(block);
    size += block.length + 2;
    part += 1;
  }
  return sections.join("\n\n");
}
