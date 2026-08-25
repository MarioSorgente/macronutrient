"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { menuNotes } from "@/lib/database";
import { useDishBuilder } from "@/store/dishBuilder";
import type { MenuRecipe } from "@/types/nutrition";
import MenuDishList from "@/components/MenuDishList";
import Modal from "@/components/ui/Modal";

export default function TemplatePicker({ onClose }: { onClose: () => void }) {
  const loadTemplate = useDishBuilder((s) => s.loadTemplate);
  const [query, setQuery] = useState("");

  function choose(recipe: MenuRecipe) {
    loadTemplate(recipe);
    onClose();
  }

  return (
    <Modal
      title="Negrita menu templates"
      subtitle={`Load a menu dish, then tweak the grams. ${menuNotes.measurement}`}
      onClose={onClose}
      subheader={
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu dishes…"
            className="w-full rounded-xl border border-cream-deep bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
          />
        </div>
      }
    >
      <MenuDishList query={query} onChoose={choose} />
    </Modal>
  );
}
