Catalogue search. Debounce 300ms and keep results in place while loading — never blank the list.

```jsx
<SearchField value={q} onChange={e=>setQ(e.target.value)} onClear={()=>setQ("")} />
```
