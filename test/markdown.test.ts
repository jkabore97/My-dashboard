import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SimpleMarkdown } from "../src/components/ai/SimpleMarkdown";

const html = (text: string) => renderToStaticMarkup(createElement(SimpleMarkdown, { text }));

describe("Ask answer formatting", () => {
  it("renders a fenced block as one code block with a copy button", () => {
    const out = html("Intro\n\n```\nStep one\n1. not a list\n**not bold**\n```\nAfter");
    expect(out).toContain("<pre");
    expect(out).toContain("1. not a list\n**not bold**");
    expect(out).toContain("Copy");
    expect(out).not.toContain("<ol");
    expect(out).toContain("<p class=\"my-2\">After</p>");
  });

  it("keeps the written numbers when a list is interrupted", () => {
    const out = html("1. First\n\n2. Second\n   continued\n3. Third");
    expect(out.match(/<ol/g)).toHaveLength(1);
    expect(out).toContain('<li value="2">Second continued</li>');
    expect(out).toContain('<li value="3">Third</li>');
  });

  it("turns --- into a rule and escapes HTML", () => {
    const out = html("---\n<script>alert(1)</script>");
    expect(out).toContain("<hr");
    expect(out).not.toContain("<script>");
  });
});
