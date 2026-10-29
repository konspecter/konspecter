import { createContext } from "react";
import type { SuggestTags } from "../../application/notes/tag-suggester";

/**
 * The library's tags to offer while one is typed (`tagSuggester`), from the
 * layout to the search box and the editors. None outside the layout (tests
 * of a single editor): nothing is offered.
 */
export const TagSuggestContext = createContext<SuggestTags | null>(null);
