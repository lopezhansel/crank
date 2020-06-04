import {CrankEventTarget, isEventTarget} from "./events";
import * as flags from "./flags";
import {
	isIteratorOrAsyncIterator,
	isNonStringIterable,
	isPromiseLike,
	MaybePromise,
	MaybePromiseLike,
	upgradePromiseLike,
} from "./utils";

// re-exporting EventMap for user extensions
export {EventMap} from "./events";

declare global {
	module JSX {
		interface IntrinsicElements {
			[tag: string]: any;
		}

		interface ElementChildrenAttribute {
			children: {};
		}
	}
}

export type Tag<TProps = any> = Component<TProps> | string | symbol;

export type TagProps<TTag extends Tag> = TTag extends Component<infer TProps>
	? TProps
	: TTag extends string
	? JSX.IntrinsicElements[TTag]
	: unknown;

type Key = unknown;

type Scope = unknown;

export type Child = Element | string | number | boolean | null | undefined;

interface ChildIterable extends Iterable<Child | ChildIterable> {}

export type Children = Child | ChildIterable;

type NormalizedChild = Element | string | undefined;

type NormalizedChildren = Array<NormalizedChild> | NormalizedChild;

// TODO: should this be exported?
export interface Props {
	"crank-key"?: Key;
	"crank-ref"?: Function;
	children?: Children;
}

export interface IntrinsicProps<T> {
	children: Array<T | string>;
	[name: string]: any;
}

const ElementSigil: unique symbol = Symbol.for("crank.ElementSigil");

export class Element<TTag extends Tag = Tag, TValue = any> {
	__sigil__: typeof ElementSigil;
	flags: number;
	tag: TTag;
	props: TagProps<TTag>;
	key: Key;
	ref: Function | undefined;
	scope: Scope;
	iterator: Iterator<TValue> | ChildIterator | undefined;
	parent: Element<Tag, TValue> | undefined;
	value: Array<TValue | string> | TValue | string | undefined;
	children: NormalizedChildren;
	childrenByKey: Map<Key, Element> | undefined;
	// TODO: DELETE ME
	renderer!: Renderer<TValue>;
	// TODO: DELETE ME
	ctx: Context | undefined;
	onNewResult: ((result?: Promise<undefined>) => unknown) | undefined;
	schedules: Set<(value: unknown) => unknown> | undefined;
	cleanups: Set<(value: unknown) => unknown> | undefined;
	// TODO: component specific. Move to Context or helper object?
	provisions: Map<unknown, unknown> | undefined;
	onProps: ((props: any) => unknown) | undefined;
	oldResult: MaybePromise<undefined>;
	inflightPending: MaybePromise<undefined>;
	enqueuedPending: MaybePromise<undefined>;
	inflightResult: MaybePromise<undefined>;
	enqueuedResult: MaybePromise<undefined>;
	constructor(
		tag: TTag,
		props: TagProps<TTag>,
		key: Key,
		ref: Function | undefined,
	) {
		this.__sigil__ = ElementSigil;
		this.tag = tag;
		this.props = props;
		this.key = key;
		this.ref = ref;
		this.flags = flags.Initial;
	}

	get childValues(): Array<TValue | string> {
		if (this.value === undefined) {
			return [];
		} else if (Array.isArray(this.value)) {
			return this.value;
		} else {
			return [this.value];
		}
	}

	get dirtyProps(): boolean {
		return (this.flags & flags.Updating) !== 0;
	}

	get dirtyChildren(): boolean {
		return (this.flags & flags.Dirty) !== 0;
	}

	get dirtyRemoval(): boolean {
		return (this.flags & flags.Removing) !== 0;
	}
}

export type FunctionComponent<TProps = any> = (
	this: Context<TProps>,
	props: TProps,
) => MaybePromiseLike<Child>;

export type ChildIterator<TNext = any> =
	| Iterator<Child, Child, TNext>
	| AsyncIterator<Child, Child, TNext>;

export type ChildGenerator<TNext = any> =
	| Generator<Child, Child, TNext>
	| AsyncGenerator<Child, Child, TNext>;

export type GeneratorComponent<TProps = any> = (
	this: Context<TProps>,
	props: TProps,
) => ChildIterator;

// TODO: Component cannot be a union of FunctionComponent | GeneratorComponent because this breaks Function.prototype methods.
// https://github.com/microsoft/TypeScript/issues/33815
export type Component<TProps = any> = (
	this: Context<TProps>,
	props: TProps,
) => ChildIterator | MaybePromiseLike<Child>;

export type Intrinsic<TValue> = (
	elem: Element<any, TValue>,
) => Iterator<TValue> | TValue;

// Special Intrinsic Tags
// TODO: We assert symbol tags as any because typescript support for symbol tags in JSX does not exist yet.
// https://github.com/microsoft/TypeScript/issues/38367
export const Fragment = Symbol.for("crank.Fragment") as any;
export type Fragment = typeof Fragment;

export const Copy = Symbol.for("crank.Copy") as any;
export type Copy = typeof Copy;

export const Portal = Symbol.for("crank.Portal") as any;
export type Portal = typeof Portal;

export const Raw = Symbol.for("crank.Raw") as any;
export type Raw = typeof Raw;

export function isElement(value: any): value is Element {
	return value != null && value.__sigil__ === ElementSigil;
}

export function createElement<TTag extends Tag>(
	tag: TTag,
	props?: TagProps<TTag> | null,
	...children: Array<unknown>
): Element<TTag>;
export function createElement<TTag extends Tag>(
	tag: TTag,
	props?: TagProps<TTag> | null,
	children?: unknown,
): Element<TTag> {
	const props1: any = {};
	let key: Key;
	let ref: Function | undefined;
	if (props != null) {
		for (const name in props) {
			if (name === "crank-key") {
				if (props[name] != null) {
					key = props[name];
				}
			} else if (name === "crank-ref") {
				if (typeof props["crank-ref"] === "function") {
					ref = props[name];
				}
			} else {
				props1[name] = props[name];
			}
		}
	}

	let length = arguments.length;
	if (length > 3) {
		const children1: Array<unknown> = [];
		while (length-- > 2) {
			children1[length - 2] = arguments[length];
		}

		props1.children = children1;
	} else if (length > 2) {
		props1.children = children;
	}

	return new Element(tag, props1, key, ref);
}

function normalize(child: Child): NormalizedChild {
	if (child == null || typeof child === "boolean") {
		return undefined;
	} else if (typeof child === "string" || isElement(child)) {
		return child;
	} else {
		return child.toString();
	}
}

function mount<TTag extends Tag, TValue>(
	elem: Element<TTag, TValue>,
	renderer: Renderer<TValue>,
	scope?: unknown,
	parent?: Element<Tag, TValue>,
): Element<TTag, TValue> {
	if (elem.flags & flags.Mounted) {
		elem = new Element(elem.tag, elem.props, elem.key, elem.ref);
	}

	elem.flags |= flags.Mounted;
	elem.renderer = renderer;
	elem.scope = scope;
	elem.parent = parent;
	if (typeof elem.tag === "function") {
		elem.ctx = new Context(elem as Element<Component>, parent && parent.ctx);
	} else {
		elem.ctx = parent && parent.ctx;
	}

	return elem;
}

function update(elem: Element): MaybePromise<undefined> {
	elem.flags |= flags.Updating;
	if (typeof elem.tag === "function") {
		return refresh(elem as Element<Component>);
	}

	return updateChildren(elem, elem.props.children);
}

function updateChildren(
	elem: Element,
	children: Children,
): MaybePromise<undefined> {
	let childScope: Scope;
	if (typeof elem.tag === "function") {
		if (isNonStringIterable(children)) {
			children = createElement(Fragment, null, children);
		}
	} else if (elem.tag !== Fragment) {
		childScope = getScope(elem.renderer, elem.tag, elem.props);
	}

	const handling = elem.flags & flags.Handling;
	let result: Promise<undefined> | undefined;
	let children1: NormalizedChildren;
	let childrenByKey: Map<Key, Element> | undefined;
	let i = 0;
	if (!isNonStringIterable(children)) {
		if (children === undefined) {
			children = [];
		} else {
			children = [children];
		}
	}

	for (let newChild of children) {
		// alignment
		let oldChild: NormalizedChild;
		if (Array.isArray(elem.children)) {
			oldChild = elem.children[i];
		} else if (i === 0) {
			oldChild = elem.children;
		}

		// TODO: reassigning newChild does not narrow to NormalizedChild
		let newChild1: NormalizedChild;
		if (isNonStringIterable(newChild)) {
			newChild1 = createElement(Fragment, null, newChild);
		} else {
			newChild1 = normalize(newChild);
		}

		if (typeof newChild1 === "object" && newChild1.key !== undefined) {
			const oldChild1 =
				elem.childrenByKey && elem.childrenByKey.get(newChild1.key);
			if (oldChild1 === undefined) {
				oldChild = undefined;
			} else {
				elem.childrenByKey!.delete(newChild1.key);
				if (oldChild === oldChild1) {
					i++;
				} else {
					oldChild = oldChild1;
					oldChild.flags |= flags.Moved;
				}
			}
		} else {
			if (typeof oldChild === "object" && oldChild.key !== undefined) {
				if (Array.isArray(elem.children)) {
					while (typeof oldChild === "object" && oldChild.key !== undefined) {
						i++;
						oldChild = elem.children[i];
					}
				} else {
					oldChild = undefined;
				}
			}

			i++;
		}

		// updating
		if (typeof newChild1 === "object") {
			let result1: Promise<undefined> | undefined;
			if (newChild1.tag === Copy) {
				// TODO: do refs make sense for copies?
				newChild1 = oldChild;
			} else if (typeof oldChild === "object") {
				if (oldChild.tag === newChild1.tag) {
					if (oldChild !== newChild) {
						oldChild.props = newChild1.props;
						oldChild.ref = newChild1.ref;
						newChild1 = oldChild;
					}

					result1 = update(newChild1);
				} else {
					newChild1 = mount(newChild1, elem.renderer, childScope, elem);
					result1 = update(newChild1);
					if (result1 === undefined) {
						unmount(oldChild);
					} else {
						// storing variables for callback closures
						const oldChild1 = oldChild;
						const newChild2 = newChild1;
						newChild1.value = oldChild.value;
						schedule(oldChild, (value) => (newChild2.value = value));
						result1.then(() => unmount(oldChild1));
					}
				}
			} else {
				newChild1 = mount(newChild1, elem.renderer, childScope, elem);
				result1 = update(newChild1);
				if (result1 !== undefined) {
					newChild1.value = oldChild;
				}
			}

			if (result1 !== undefined) {
				result = result === undefined ? result1 : result.then(() => result1);
			}
		} else {
			if (typeof oldChild === "object") {
				unmount(oldChild);
			}

			if (typeof newChild1 === "string") {
				newChild1 = getText(elem.renderer, newChild1);
			}
		}

		// push to children1
		if (children1 === undefined) {
			children1 = newChild1;
		} else {
			if (!Array.isArray(children1)) {
				children1 = [children1];
			}

			children1.push(newChild1);
		}

		// add to childrenByKey
		if (typeof newChild1 === "object" && newChild1.key !== undefined) {
			if (childrenByKey === undefined) {
				childrenByKey = new Map();
			}

			if (!childrenByKey.has(newChild1.key)) {
				childrenByKey.set(newChild1.key, newChild1);
			}
		}
	}

	if (handling !== (elem.flags & flags.Handling)) {
		elem.flags &= ~flags.Handling;
		return;
	}

	if (elem.children !== undefined) {
		if (Array.isArray(elem.children)) {
			for (; i < elem.children.length; i++) {
				const oldChild = elem.children[i];
				if (typeof oldChild === "object" && oldChild.key === undefined) {
					unmount(oldChild);
				}
			}
		} else if (
			i === 0 &&
			typeof elem.children === "object" &&
			elem.children.key === undefined
		) {
			unmount(elem.children);
		}
	}

	// TODO: likely where logic for asynchronous unmounting will go
	if (elem.childrenByKey !== undefined) {
		for (const child of elem.childrenByKey.values()) {
			unmount(child);
		}
	}

	elem.children = children1;
	elem.childrenByKey = childrenByKey;

	if (elem.onNewResult !== undefined) {
		elem.onNewResult(result);
		elem.onNewResult = undefined;
	}

	if (result !== undefined) {
		result = result.then(() => commit(elem));
		const newResult = new Promise<undefined>(
			(resolve) => (elem.onNewResult = resolve),
		);

		return Promise.race([result, newResult]);
	}

	return commit(elem);
}

function prepareCommit<TValue>(elem: Element<Tag, TValue>): void {
	if (elem.children === undefined) {
		elem.flags |= flags.Dirty;
		elem.value = undefined;
		return;
	} else if (!Array.isArray(elem.children)) {
		const child = elem.children;
		if (typeof child === "object") {
			if (child.flags & (flags.Dirty | flags.Moved)) {
				elem.flags |= flags.Dirty;
			}

			child.flags &= ~(flags.Dirty | flags.Moved);
		} else {
			elem.flags |= flags.Dirty;
		}

		if (typeof child === "object") {
			if (child.tag === Portal) {
				elem.value = undefined;
			} else {
				elem.value = child.value;
			}
		} else {
			elem.value = child;
		}

		return;
	}

	let buffer: string | undefined;
	let values: Array<TValue | string> = [];
	for (let i = 0; i < elem.children.length; i++) {
		const child = elem.children[i];
		if (typeof child === "object") {
			if (child.flags & (flags.Dirty | flags.Moved)) {
				elem.flags |= flags.Dirty;
			}

			child.flags &= ~(flags.Dirty | flags.Moved);
		} else {
			elem.flags |= flags.Dirty;
		}

		if (typeof child === "object" && child.tag === Portal) {
			continue;
		}

		const value = typeof child === "object" ? child.value : child;
		if (typeof value === "string") {
			buffer = buffer === undefined ? value : buffer + value;
		} else {
			if (buffer !== undefined) {
				values.push(buffer);
				buffer = undefined;
			}

			if (Array.isArray(value)) {
				values = values.concat(value);
			} else if (value !== undefined) {
				values.push(value);
			}
		}
	}

	if (buffer !== undefined) {
		values.push(buffer);
	}

	if (values.length === 0) {
		elem.flags |= flags.Dirty;
		elem.value = undefined;
	} else if (values.length === 1) {
		elem.value = values[0];
	} else {
		elem.value = values;
	}
}

function commit<TValue>(elem: Element<any, TValue>): MaybePromise<undefined> {
	const oldValue = elem.value;
	prepareCommit(elem);
	if (typeof elem.tag === "function") {
		if (isEventTarget(elem.value)) {
			elem.ctx!.setDelegate(elem.value);
		} else if (Array.isArray(elem.value)) {
			elem.ctx!.setDelegates(elem.value);
		}
	} else if (elem.tag !== Fragment) {
		try {
			if (elem.iterator === undefined) {
				const value = getIntrinsic(elem.renderer, elem.tag)(elem);
				if (!isIteratorOrAsyncIterator(value)) {
					if (oldValue === value) {
						elem.flags &= ~flags.Dirty;
					} else {
						elem.flags |= flags.Dirty;
					}

					elem.value = value;
					return;
				}

				elem.iterator = value;
			}

			const iteration = (elem.iterator as Iterator<TValue>).next();
			if (oldValue === iteration.value) {
				elem.flags &= ~flags.Dirty;
			} else {
				elem.flags |= flags.Dirty;
			}

			elem.value = iteration.value;
			if (iteration.done) {
				elem.flags |= flags.Finished;
			}
		} catch (err) {
			if (elem.parent === undefined) {
				throw err;
			}

			return handle(elem.parent, err);
		}
	}

	if (elem.schedules !== undefined && elem.schedules.size > 0) {
		// We have to clear the schedules set before calling each callback,
		// because otherwise a callback which refreshes the component would cause
		// a stack overflow.
		const callbacks = Array.from(elem.schedules);
		elem.schedules.clear();
		for (const callback of callbacks) {
			callback(elem.value);
		}
	}

	if (elem.ref !== undefined) {
		elem.ref(elem.value);
	}

	if (
		!(elem.flags & flags.Updating) &&
		elem.flags & flags.Dirty &&
		elem.parent !== undefined
	) {
		commit(elem.parent);
	}

	elem.flags &= ~flags.Updating;
}

function unmount(elem: Element, dirty = true): MaybePromise<undefined> {
	if (elem.cleanups !== undefined) {
		for (const cleanup of elem.cleanups) {
			cleanup(elem.value);
		}

		elem.cleanups = undefined;
	}

	if (elem.flags & flags.Unmounted) {
		return;
	}

	// setting unmounted flag here is necessary because of some kind of race condition
	elem.flags |= flags.Unmounted;
	if (!(elem.flags & flags.Finished)) {
		elem.flags |= flags.Finished;
		if (elem.tag === Fragment) {
			// pass
		} else if (typeof elem.tag === "function") {
			if (elem.onProps !== undefined) {
				elem.onProps(elem.props!);
				elem.onProps = undefined;
			}

			elem.ctx!.clearEventListeners();
			if (elem.iterator !== undefined && elem.iterator.return) {
				let iteration: IteratorResult<Child> | Promise<IteratorResult<Child>>;
				try {
					iteration = (elem.iterator as ChildIterator).return!();
				} catch (err) {
					return handle(elem.parent!, err);
				}

				if (isPromiseLike(iteration)) {
					return iteration.then(
						() => {
							elem.flags &= ~flags.Updating;
							unmountChildren(elem, dirty);
							return undefined; // void :(
						},
						(err) => handle(elem.parent!, err),
					);
				}
			}
		} else {
			if (dirty) {
				elem.flags |= flags.Removing;
			} else {
				elem.flags &= ~flags.Removing;
			}

			dirty = elem.tag === Portal;
			if (elem.iterator !== undefined && elem.iterator.return) {
				try {
					elem.iterator.return();
				} catch (err) {
					if (elem.parent === undefined) {
						throw err;
					}

					return handle(elem.parent, err);
				}
			}
		}
	}

	elem.flags &= ~flags.Updating;
	unmountChildren(elem, dirty);
}

function unmountChildren(elem: Element, dirty: boolean): void {
	const children =
		elem.children === "undefined"
			? []
			: Array.isArray(elem.children)
			? elem.children
			: [elem.children];
	for (const child of children) {
		if (typeof child === "object") {
			unmount(child, dirty);
		}
	}
}

function handle(elem: Element, reason: unknown): MaybePromise<undefined> {
	elem.flags |= flags.Handling;
	// helps avoid deadlocks
	if (elem.onProps !== undefined) {
		elem.onProps(elem.props!);
		elem.onProps = undefined;
	}

	if (
		typeof elem.tag === "function" &&
		elem.iterator !== undefined &&
		elem.iterator.throw !== undefined &&
		!(elem.flags & flags.Finished)
	) {
		let iteration: IteratorResult<Child> | Promise<IteratorResult<Child>>;
		try {
			iteration = (elem.iterator as ChildIterator).throw!(reason);
		} catch (err) {
			return handle(elem.parent!, err);
		}

		if (isPromiseLike(iteration)) {
			return iteration.then(
				(iteration) => {
					if (iteration.done) {
						elem.flags |= flags.Finished;
					}

					return updateChildren(elem, iteration.value);
				},
				(err) => {
					return handle(elem.parent!, err);
				},
			);
		}

		if (iteration.done) {
			elem.flags |= flags.Finished;
		}

		return updateChildren(elem, iteration.value);
	} else if (elem.parent === undefined) {
		throw reason;
	}

	return handle(elem.parent, reason);
}

function refresh(elem: Element<Component>): MaybePromise<undefined> {
	if (elem.flags & (flags.Stepping | flags.Unmounted)) {
		// TODO: we may want to log warnings when stuff like elem happens
		return;
	}

	if (elem.onProps === undefined) {
		elem.flags |= flags.Available;
	} else {
		elem.onProps(elem.props!);
		elem.onProps = undefined;
	}

	return run(elem);
}

function run(elem: Element): MaybePromise<undefined> {
	if (elem.inflightPending === undefined) {
		const [pending, result] = step(elem);
		if (pending !== undefined) {
			elem.inflightPending = pending.finally(() => advance(elem));
		}

		if (result !== undefined) {
			elem.inflightResult = result;
		}

		return elem.inflightResult;
	} else if (elem.flags & flags.AsyncGen) {
		return elem.inflightResult;
	} else if (elem.enqueuedPending === undefined) {
		let resolve: (value: MaybePromise<undefined>) => unknown;
		elem.enqueuedPending = elem.inflightPending
			.then(() => {
				const [pending, result] = step(elem);
				resolve(result);
				return pending;
			})
			.finally(() => advance(elem));
		elem.enqueuedResult = new Promise((resolve1) => (resolve = resolve1));
	}

	return elem.enqueuedResult;
}

function step<TValue>(
	elem: Element<any, TValue>,
): [MaybePromise<undefined>, MaybePromise<undefined>] {
	if (elem.flags & flags.Finished) {
		return [undefined, undefined];
	}

	elem.flags |= flags.Stepping;
	if (elem.iterator === undefined) {
		elem.ctx!.clearEventListeners();
		let value: ChildIterator | PromiseLike<Child> | Child;
		try {
			value = (elem.tag as Component).call(elem.ctx!, elem.props!);
		} catch (err) {
			const caught = handle(elem.parent!, err);
			return [undefined, caught];
		}

		if (isIteratorOrAsyncIterator(value)) {
			elem.iterator = value;
		} else if (isPromiseLike(value)) {
			const value1 = upgradePromiseLike(value);
			const pending = value1.then(
				() => undefined,
				() => undefined,
			); // void :(
			const result = value1.then(
				(child) => updateChildren(elem, child),
				(err) => handle(elem.parent!, err),
			);
			elem.flags &= ~flags.Stepping;
			return [pending, result];
		} else {
			const result = updateChildren(elem, value);
			elem.flags &= ~flags.Stepping;
			return [undefined, result];
		}
	}

	let oldValue: MaybePromise<
		Array<TValue | string> | TValue | string | undefined
	>;
	if (elem.oldResult === undefined) {
		oldValue = elem.value;
	} else {
		oldValue = elem.oldResult.then(() => elem.value);
		elem.oldResult = undefined;
	}

	let iteration: IteratorResult<Child> | Promise<IteratorResult<Child>>;
	try {
		iteration = (elem.iterator as ChildIterator).next(oldValue);
	} catch (err) {
		const caught = handle(elem.parent!, err);
		return [caught, caught];
	}

	elem.flags &= ~flags.Stepping;
	if (isPromiseLike(iteration)) {
		elem.flags |= flags.AsyncGen;
		iteration = iteration.catch((err) => {
			const caught = handle(elem.parent!, err);
			if (caught === undefined) {
				return {value: undefined, done: true};
			}

			return caught.then(() => ({value: undefined, done: true}));
		});
		const pending = iteration.then(
			() => undefined,
			() => undefined,
		); // void :(
		const result = iteration.then((iteration) => {
			elem.flags &= ~flags.Iterating;
			if (iteration.done) {
				elem.flags |= flags.Finished;
			}

			let result = updateChildren(elem, iteration.value);
			if (isPromiseLike(result)) {
				elem.oldResult = result.catch(() => undefined); // void :(
			}

			return result;
		});

		return [pending, result];
	}

	elem.flags &= ~flags.Iterating;
	elem.flags |= flags.SyncGen;
	if (iteration.done) {
		elem.flags |= flags.Finished;
	}

	const result = updateChildren(elem, iteration.value);
	return [result, result];
}

function advance(elem: Element): void {
	elem.inflightPending = elem.enqueuedPending;
	elem.inflightResult = elem.enqueuedResult;
	elem.enqueuedPending = undefined;
	elem.enqueuedResult = undefined;
	if (elem.flags & flags.AsyncGen && !(elem.flags & flags.Finished)) {
		run(elem)!.catch((err) => {
			// We catch and rethrow the error to trigger an unhandled promise rejection.
			if (!(elem.flags & flags.Updating)) {
				throw err;
			}
		});
	}
}

function schedule(elem: Element, callback: (value: unknown) => unknown): void {
	if (elem.schedules === undefined) {
		elem.schedules = new Set();
	}

	elem.schedules.add(callback);
}

function cleanup(elem: Element, callback: (value: unknown) => unknown): void {
	if (elem.cleanups === undefined) {
		elem.cleanups = new Set();
	}

	elem.cleanups.add(callback);
}

export interface ProvisionMap {}

export class Context<TProps = any> extends CrankEventTarget {
	__elem__: Element<Component, TProps>;
	constructor(
		elem: Element<Component, TProps>,
		parent: Context<TProps> | undefined,
	) {
		super(parent);
		this.__elem__ = elem;
	}

	get<TKey extends keyof ProvisionMap>(key: TKey): ProvisionMap[TKey];
	get(key: unknown): any {
		for (
			let parent: Element<any> | undefined = this.__elem__.parent;
			parent !== undefined;
			parent = parent.parent
		) {
			if (parent.provisions !== undefined && parent.provisions.has(key)) {
				return parent.provisions.get(key)!;
			}
		}
	}

	set<TKey extends keyof ProvisionMap>(
		key: TKey,
		value: ProvisionMap[TKey],
	): void;
	set(key: unknown, value: any): void {
		if (this.__elem__.provisions === undefined) {
			this.__elem__.provisions = new Map();
		}

		this.__elem__.provisions.set(key, value);
	}

	get props(): TProps {
		return this.__elem__.props;
	}

	get value(): unknown {
		return this.__elem__.value;
	}

	*[Symbol.iterator](): Generator<TProps> {
		const elem = this.__elem__;
		while (!(elem.flags & flags.Unmounted)) {
			if (elem.flags & flags.Iterating) {
				throw new Error("You must yield for each iteration of this.");
			} else if (elem.flags & flags.AsyncGen) {
				throw new Error("Use for await...of in async generator components.");
			}

			elem.flags |= flags.Iterating;
			yield elem.props!;
		}
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<TProps> {
		const elem = this.__elem__;
		do {
			if (elem.flags & flags.Iterating) {
				throw new Error("You must yield for each iteration of this.");
			} else if (elem.flags & flags.SyncGen) {
				throw new Error("Use for...of in sync generator components.");
			}

			elem.flags |= flags.Iterating;
			if (elem.flags & flags.Available) {
				elem.flags &= ~flags.Available;
				yield elem.props!;
			} else {
				const props = await new Promise<any>(
					(resolve) => (elem.onProps = resolve),
				);
				if (!(elem.flags & flags.Unmounted)) {
					yield props;
				}
			}
		} while (!(elem.flags & flags.Unmounted));
	}

	refresh(): Promise<undefined> | undefined {
		return refresh(this.__elem__);
	}

	schedule(callback: (value: unknown) => unknown): void {
		return schedule(this.__elem__, callback);
	}

	cleanup(callback: (value: unknown) => unknown): void {
		return cleanup(this.__elem__, callback);
	}
}

export const Default = Symbol.for("crank.Default");

export const Text = Symbol.for("crank.Text");

export const Scopes = Symbol.for("crank.Scopes");

export interface Scoper {
	[Default]?(tag: string | symbol, props: any): Scope;
	[tag: string]: Scope;
}

export interface Environment<TValue> {
	[Default]?(tag: string | symbol): Intrinsic<TValue>;
	[Text]?(text: string): string;
	[Scopes]?: Scoper;
	[tag: string]: Intrinsic<TValue>;
	// TODO: uncomment
	// [Portal]?: Intrinsic<TValue>;
	// [Raw]?: Intrinsic<TValue>;
}

const defaultEnv: Environment<any> = {
	[Default](tag: string): never {
		throw new Error(`Environment did not provide an intrinsic for tag: ${tag}`);
	},
	[Portal](): never {
		throw new Error("Environment did not provide an intrinsic for Portal");
	},
	[Raw](elem: Element<any, any>): any {
		return elem.props.value;
	},
};

export class Renderer<TValue> {
	__cache__ = new WeakMap<object, Element<any, TValue>>();
	__defaults__: Record<string, Intrinsic<TValue>> = {};
	__env__: Environment<TValue> = {...defaultEnv};
	__scoper__: Scoper = {};
	constructor(env?: Environment<TValue>) {
		this.extend(env);
	}

	extend(env?: Environment<TValue>): void {
		if (env == null) {
			return;
		}

		for (const tag of Object.keys(env)) {
			if (env[tag] != null) {
				this.__env__[tag] = env[tag]!;
			}
		}

		for (const tag of Object.getOwnPropertySymbols(env)) {
			if (env[tag as any] != null && tag !== Scopes) {
				this.__env__[tag as any] = env[tag as any]!;
			}
		}

		if (env[Scopes] != null) {
			const scoper = env[Scopes]!;
			for (const tag of Object.keys(scoper)) {
				if (scoper[tag] != null) {
					this.__scoper__[tag] = scoper[tag]!;
				}
			}

			for (const tag of Object.getOwnPropertySymbols(env)) {
				if (scoper[tag as any] != null) {
					this.__scoper__[tag as any] = scoper[tag as any]!;
				}
			}
		}
	}

	// TODO: clean this method up
	render(children: Children, root?: object): MaybePromise<TValue> {
		const clearing = children == null;
		if (isNonStringIterable(children)) {
			children = createElement(Fragment, null, children);
		}

		const portal: Element<Portal> =
			isElement(children) && children.tag === Portal
				? children
				: createElement(Portal, {root}, children);
		let elem: Element<Portal, TValue> | undefined =
			root != null ? this.__cache__.get(root) : undefined;

		if (elem === undefined) {
			elem = mount(portal, this);
			if (root != null && !clearing) {
				this.__cache__.set(root, elem);
			}
		} else if (root != null && clearing) {
			this.__cache__.delete(root);
		}

		elem.props = portal.props;
		elem.ref = portal.ref;
		const result = update(elem);
		if (isPromiseLike(result)) {
			return result.then(() => {
				commit(elem!);
				if (portal.props.root == null) {
					unmount(elem!);
				}

				return elem!.value! as MaybePromise<TValue>;
			});
		}

		commit(elem!);
		if (portal.props.root == null) {
			unmount(elem);
		}

		return elem.value! as MaybePromise<TValue>;
	}
}

function getIntrinsic<TValue>(
	renderer: Renderer<TValue>,
	tag: string | symbol,
): Intrinsic<TValue> {
	if (renderer.__env__[tag as any]) {
		return renderer.__env__[tag as any];
	} else if (renderer.__defaults__[tag as any] !== undefined) {
		return renderer.__defaults__[tag as any];
	}

	const intrinsic = renderer.__env__[Default]!(tag);
	renderer.__defaults__[tag as any] = intrinsic;
	return intrinsic;
}

function getText(renderer: Renderer<any>, text: string): string {
	if (renderer.__env__[Text] !== undefined) {
		return renderer.__env__[Text]!(text);
	}

	return text;
}

function getScope(
	renderer: Renderer<any>,
	tag: string | symbol,
	props: any,
): Scope {
	if (tag in renderer.__scoper__) {
		if (typeof renderer.__scoper__[tag as any] === "function") {
			return (renderer.__scoper__[tag as any] as Function)(props);
		}

		return renderer.__scoper__[tag as any];
	} else if (typeof renderer.__scoper__[Default] === "function") {
		return renderer.__scoper__[Default]!(tag, props);
	}
}
