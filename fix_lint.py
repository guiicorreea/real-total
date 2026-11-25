p = 'src/App.jsx'
s = open(p, encoding='utf-8').read()

# Fix all empty catch blocks
s = s.replace('try { window.localStorage.setItem(\'real-total:last-insights-month\', monthKey) } catch {}', 'try { window.localStorage.setItem("real-total:last-insights-month", monthKey) } catch { /* ignore */ }')
s = s.replace("try { stored = window.localStorage.getItem('real-total:last-budget-month') ?? '' } catch {}", "try { stored = window.localStorage.getItem('real-total:last-budget-month') ?? '' } catch { /* ignore */ }")
s = s.replace("try { window.localStorage.setItem('real-total:last-budget-month', monthKey) } catch {}", "try { window.localStorage.setItem('real-total:last-budget-month', monthKey) } catch { /* ignore */ }")
s = s.replace('} catch {}', '} catch { /* ignore */ }')

open(p, 'w', encoding='utf-8').write(s)
print('done')