RELEASE_TYPE: minor

* Rename `arrays` to `lists`.
* Rename `dicts` to `maps`.
* Replace `tuples2`, `tuples3`, etc, with a generic `tuples` generator which accepts a variable number of arguments.
* `Settings.database` now accepts a proper tagged struct `Database`, instead of interpreting magic strings like `"unset"`.
* Replace `ipv4Addresses` and `ipv6Addresses` with a unified `ipAddresses` generator that takes a `version` argument.
