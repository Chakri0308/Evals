from pydantic import BaseModel, Field

from app.core.registry import Component, register

DEFAULT_TEMPLATE = """Use the style-guide excerpts below to answer the question.

Context:
{context}

Question: {question}

Answer:"""

CLOSED_BOOK = """Answer the question about writing style from your own knowledge.

Question: {question}

Answer:"""


@register("prompt", "template", label="Template", order=1)
class TemplatePrompt(Component):
    """An editable template with {context} and {question} placeholders, plus optional citation and abstention rules."""

    class Params(BaseModel):
        template: str = Field(DEFAULT_TEMPLATE, description="Prompt template ({context}, {question})",
                              json_schema_extra={"x-widget": "textarea"})
        system: str = Field("You are a precise assistant that answers questions about a writing style guide.",
                            description="System prompt", json_schema_extra={"x-widget": "textarea"})
        cite_chunk_ids: bool = Field(True, description="Ask the model to cite chunk IDs like [C3]")
        strict_context: bool = Field(True, description="Answer only from context, otherwise say \"I don't know\"")
        include_source_location: bool = Field(True, description="Show the page/heading next to each chunk in the context")

    def build(self, question, chunks, closed_book):
        p = self.p
        system = p.system
        rules = []
        if closed_book:
            user = CLOSED_BOOK.format(question=question)
            return {"system": system, "user": user, "closed_book": True}
        if p.cite_chunk_ids:
            rules.append("After each fact, cite the ID of the chunk it came from in square brackets, like [C3].")
        if p.strict_context:
            rules.append("Use only the context. Only if no part of the context is relevant, reply exactly: I don't know.")
        if rules:
            system = system + "\n" + "\n".join("- " + r for r in rules)
        parts = []
        for c in chunks:
            loc = ""
            if p.include_source_location:
                bits = []
                if c.page:
                    bits.append(f"p.{c.page}")
                if c.heading_path:
                    bits.append(" > ".join(c.heading_path))
                loc = f" ({'; '.join(bits)})" if bits else ""
            parts.append(f"[{c.id}]{loc}\n{c.text}")
        context = "\n\n".join(parts) if parts else "(no context)"
        tmpl = p.template if "{question}" in p.template else p.template + "\n\nQuestion: {question}"
        user = tmpl.replace("{context}", context).replace("{question}", question)
        if rules:
            # Small local models follow instructions far better when they sit right before the answer.
            user = user.rstrip()
            tail = "Answer:" if user.endswith("Answer:") else ""
            if tail:
                user = user[: -len(tail)].rstrip()
            user += ("\n\nInstructions: Answer the question in 1-4 sentences using the context above. "
                     + " ".join(rules) + ("\n\n" + tail if tail else ""))
        return {"system": system, "user": user, "closed_book": False}
