import { Controller } from '@hotwired/stimulus';

export default class extends Controller {
	highlight(event: Event) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		this.mark(target.closest('[data-district]'));
	}

	clear() {
		for (const el of this.element.querySelectorAll('.linked')) el.classList.remove('linked');
	}

	release(event: FocusEvent) {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !this.element.contains(next)) this.clear();
	}

	mark(active: Element | null) {
		this.clear();
		if (!(active instanceof HTMLElement || active instanceof SVGElement)) return;
		const key = active.dataset.district;
		if (!key) return;
		for (const el of this.element.querySelectorAll(`[data-district="${CSS.escape(key)}"]`)) {
			if (el === active) continue;
			el.classList.add('linked');
			// Later districts paint over this stroke. Draw the outline last so the border stays whole.
			if (el instanceof SVGElement && el.parentElement) el.parentElement.appendChild(el);
		}
	}
}
