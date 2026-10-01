# Sentinels

Tests that watch the dependencies, and nothing else.

A sentinel fails when a dependency changes behaviour this design rests on. That
is the only warning available for a decision built on something we do not
control, and it is only a warning if it exercises the dependency **directly**:
through our own wrapper it measures the wrapper, and it keeps passing while the
thing underneath moves.

That distinction had been made in prose and violated in practice — four entries
classified as sentinels went through the shipping code, one of them through an
option that exists only for the spike. So the boundary is a directory, and a
test asserts that nothing here imports from `$lib`.
