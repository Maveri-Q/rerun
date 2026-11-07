"use client";

import { createContext } from "react";

/** Answers the server already read from the chain, by cache key, so the first HTML has real content. */
export const SeedContext = createContext<Record<string, unknown>>({});
