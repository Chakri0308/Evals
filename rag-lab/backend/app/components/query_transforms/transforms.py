"""Query transformers. (Several small classes in one file: they share prompts and helpers.)"""
from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.types import QueryBundle

from ._util import llm_call, parse_lines


@register("query_transform", "none", label="None", order=0)
class NoTransform(Component):
    """Uses the question as-is."""

    async def transform(self, question, ctx):
        return QueryBundle(original=question, queries=[question], dense_queries=[question])


@register("query_transform", "rewrite", label="Query rewrite", order=1)
class Rewrite(Component):
    """The LLM rewrites the question into a clearer, keyword-rich search query."""

    class Params(BaseModel):
        keep_original: bool = Field(True, description="Also search with the original question")

    async def transform(self, question, ctx):
        out = await llm_call(ctx, "You rewrite user questions into concise search queries for a style guide. "
                             "Output only the rewritten query on one line.", f"Question: {question}")
        rq = parse_lines(out, 1) or [question]
        qs = ([question] if self.p.keep_original else []) + rq
        return QueryBundle(original=question, queries=qs, dense_queries=qs, notes={"rewritten": rq[0]})


@register("query_transform", "multi_query", label="Multi-query", order=2)
class MultiQuery(Component):
    """Generates N alternative phrasings. Each is retrieved, and the results are unioned."""

    class Params(BaseModel):
        n: int = Field(3, ge=2, le=6, description="Number of rewrites")
        keep_original: bool = Field(True, description="Include the original question")

    async def transform(self, question, ctx):
        out = await llm_call(ctx, f"Generate {self.p.n} different search queries that would help answer the "
                             "question from a writing style guide. Use varied vocabulary. One per line, no numbering.",
                             f"Question: {question}")
        rq = parse_lines(out, self.p.n) or [question]
        qs = ([question] if self.p.keep_original else []) + rq
        return QueryBundle(original=question, queries=qs, dense_queries=qs, notes={"queries": rq})


@register("query_transform", "hyde", label="HyDE", order=3)
class HyDE(Component):
    """Hypothetical Document Embeddings: the LLM drafts an answer, and that draft is embedded for dense search. BM25 still uses the question."""

    class Params(BaseModel):
        include_question: bool = Field(True, description="Also embed the raw question")

    async def transform(self, question, ctx):
        hypo = await llm_call(ctx, "Write a short passage (3-4 sentences) from a writing style guide that answers "
                              "the question. Be specific; invent plausible details if needed.", f"Question: {question}")
        dq = ([question] if self.p.include_question else []) + [hypo]
        return QueryBundle(original=question, queries=[question], dense_queries=dq, notes={"hypothetical_doc": hypo})


@register("query_transform", "decompose", label="Decomposition", order=4)
class Decompose(Component):
    """Splits a multi-hop question into simpler sub-questions. Each is retrieved separately."""

    class Params(BaseModel):
        max_sub_questions: int = Field(3, ge=2, le=5, description="Maximum sub-questions")

    async def transform(self, question, ctx):
        out = await llm_call(ctx, f"Break the question into at most {self.p.max_sub_questions} simple, self-contained "
                             "sub-questions that together answer it. If it is already simple, repeat it. One per line.",
                             f"Question: {question}")
        subs = parse_lines(out, self.p.max_sub_questions) or [question]
        qs = [question] + subs
        return QueryBundle(original=question, queries=qs, dense_queries=qs, notes={"sub_questions": subs})
