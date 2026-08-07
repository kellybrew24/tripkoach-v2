Password field with a show/hide toggle and a live rules checklist — never hide the rules until failure.

```jsx
<PasswordInput id="pw" value={pw} onChange={e=>setPw(e.target.value)}
  rules={[{label:"8+ characters",met:pw.length>=8},{label:"A number",met:/\d/.test(pw)}]} />
```
